import os, sys, io, json, time
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")
repo = "F:/TTSAI/GPT-SoVITS-v2pro-20250604"
os.chdir(repo)
sys.path.insert(0, repo)
sys.path.insert(0, repo + "/GPT_SoVITS")
import numpy as np
import torch, torchaudio
import types as _types

_mu = _types.ModuleType("my_utils")
_mu.load_audio = lambda *a, **k: (_ for _ in ()).throw(NotImplementedError)
sys.modules["my_utils"] = _mu

OUT = "F:/Nori-Desktop-Pet/app/android/app/src/main/assets/tts_data"
os.makedirs(OUT, exist_ok=True)
REF_DIR = "F:/Nori-Desktop-Pet/app/android/app/src/main/assets/ref"
P = repo + "/GPT_SoVITS/pretrained_models"
t0 = time.time()

from transformers import AutoTokenizer, AutoModel
import torch.nn as nn

print("[1] re-export roberta (hidden_states[-3]) ...", flush=True)
rdir = P + "/chinese-roberta-wwm-ext-large"
tokenizer = AutoTokenizer.from_pretrained(rdir)
rmodel = AutoModel.from_pretrained(rdir).eval()

class RobertaFeat(nn.Module):
    def __init__(self, m):
        super().__init__()
        self.m = m
    def forward(self, input_ids):
        res = self.m(input_ids=input_ids, output_hidden_states=True)
        return res["hidden_states"][-3]

feat = RobertaFeat(rmodel).eval()
D = "onnx/nori"
if not os.path.exists(D + "/nori_roberta_int8.onnx"):
    dummy = torch.ones(1, 16, dtype=torch.long)
    with torch.no_grad():
        torch.onnx.export(feat, (dummy,), os.path.join(D, "nori_roberta_fp32.onnx"),
            input_names=["input_ids"], output_names=["feat"],
            dynamic_axes={"input_ids": {1: "N"}, "feat": {1: "N"}},
            opset_version=16)
    print("  exported fp32 %.1f MB" % (os.path.getsize(D + "/nori_roberta_fp32.onnx") / 1e6), flush=True)

    from onnxruntime.quantization import quantize_dynamic, QuantType
    quantize_dynamic(D + "/nori_roberta_fp32.onnx", D + "/nori_roberta_int8.onnx",
        weight_type=QuantType.QInt8, per_channel=True, op_types_to_quantize=["MatMul", "Gemm"])
print("  int8 %.1f MB" % (os.path.getsize(D + "/nori_roberta_int8.onnx") / 1e6), flush=True)

print("[2] symbols + pinyin table ...", flush=True)
from text import symbols2
from text import cleaned_text_to_sequence
json.dump(list(symbols2.symbols), open(OUT + "/symbols.json", "w", encoding="utf-8"),
    ensure_ascii=False, indent=0)

from text.chinese import g2p as zh_g2p
import re as _re

def has_pinyin(ch):
    return _re.match(r'[\u4e00-\u9fff]', ch) is not None

table = {}
n = 0
for cp in range(0x4E00, 0xA000):
    ch = chr(cp)
    try:
        phs, w2ph = zh_g2p(ch)
    except Exception:
        continue
    phs = [p for p in phs if p]
    if not phs or any(p not in symbols2.symbols for p in phs):
        continue
    table[ch] = " ".join(phs)
    n += 1
    if n % 2000 == 0:
        print("  %d chars" % n, flush=True)
with open(OUT + "/pinyin.tsv", "w", encoding="utf-8") as f:
    for ch, phs in table.items():
        f.write("%s\t%s\n" % (ch, phs))
print("  char table: %d entries" % len(table), flush=True)

tok = tokenizer
vocab = tok.get_vocab()
json.dump(vocab, open(OUT + "/roberta_vocab.json", "w", encoding="utf-8"), ensure_ascii=False)
print("  vocab: %d" % len(vocab), flush=True)

print("[3] precompute ref features ...", flush=True)
from inference_webui import get_phones_and_bert
from feature_extractor import cnhubert
cnhubert.cnhubert_base_path = P + "/chinese-hubert-base"
ssl_model = cnhubert.get_model().model.eval()

def load16k(p):
    w, sr = torchaudio.load(p)
    if w.shape[0] > 1: w = w.mean(0, keepdim=True)
    return torchaudio.functional.resample(w, sr, 16000).float()

refs = json.load(open(REF_DIR + "/refs.json", encoding="utf-8"))
for r in refs:
    name = r["name"]
    seq_id, bert_T, _ = get_phones_and_bert(r["prompt"], "all_zh", "v2")
    bert = bert_T.cpu().T.float().numpy().astype(np.float32)     # [T,1024]
    w16 = load16k(os.path.join(REF_DIR, r["audio"]))
    with torch.no_grad():
        sslc = ssl_model(w16)["last_hidden_state"].transpose(1, 2).float().numpy().astype(np.float32)  # [1,768,T']
    sslc = sslc[0]                                              # [768,T']
    rb = "refbert_%s.bin" % name
    rs = "refssl_%s.bin" % name
    bert.tofile(os.path.join(OUT, rb))
    sslc.tofile(os.path.join(OUT, rs))
    r["refSeq"] = [int(x) for x in seq_id]
    r["refBertFile"] = rb; r["refBertRows"] = int(bert.shape[0])
    r["refSslFile"] = rs; r["refSslT"] = int(sslc.shape[1])
    print("  %-12s seq=%d bert=%s sslT=%d" % (name, len(seq_id), bert.shape, sslc.shape[1]), flush=True)
json.dump(refs, open(OUT + "/refs.json", "w", encoding="utf-8"), ensure_ascii=False, indent=1)

print("[4] validate pure-ONNX runtime ...", flush=True)
import onnxruntime as ort
prov = ["CPUExecutionProvider"]
opts = ort.SessionOptions()
opts.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL

def sess(f): return ort.InferenceSession(os.path.join(D, f), sess_options=opts, providers=prov)
s_ro = sess("nori_roberta_int8.onnx")
s_enc = sess("nori_t2s_encoder_fp32.onnx")
s_fsd = sess("nori_t2s_fsdec_fp32.onnx")
s_sdc = sess("nori_t2s_sdec_fp32.onnx")
s_vits = sess("nori_vits_fp32.onnx")

def cos(a, b):
    a = a.flatten(); b = b.flatten()
    return float((a @ b) / (np.linalg.norm(a) * np.linalg.norm(b) + 1e-9))

with torch.no_grad():
    enc = tok("今天天气怎么样呀", return_tensors="pt")
    t_ref = rmodel(**enc, output_hidden_states=True)["hidden_states"][-3].numpy()
o = s_ro.run(None, {"input_ids": enc["input_ids"].numpy().astype(np.int64)})[0]
print("  roberta int8 cos=%.6f" % cos(o, t_ref), flush=True)

TEXT = "太好了我早就猜到你会这么说了真的特别开心"
phs, w2ph = zh_g2p(TEXT)
phs = [p for p in phs if p]
text_seq = np.array([cleaned_text_to_sequence(phs, "v2")], np.int64)

ids = tok(TEXT, return_tensors="pt")["input_ids"].numpy().astype(np.int64)
feat = s_ro.run(None, {"input_ids": ids})[0][0]                 # [Ttok,1024]
feat = feat[1:-1]                                               # drop CLS/SEP
assert len(w2ph) == len(TEXT), (len(w2ph), len(TEXT))
rows = []
for i, c in enumerate(TEXT):
    k = w2ph[i]
    for _ in range(k):
        rows.append(feat[i])
text_bert = np.asarray(rows, np.float32)                        # [T,1024]
assert text_bert.shape[0] == text_seq.shape[1], (text_bert.shape, text_seq.shape)

ref = next(r for r in refs if r["name"] == "happy")
ref_seq = np.array([ref["refSeq"]], np.int64)
ref_bert = np.fromfile(os.path.join(OUT, ref["refBertFile"]), np.float32).reshape(ref["refBertRows"], 1024)
ssl_arr = np.fromfile(os.path.join(OUT, ref["refSslFile"]), np.float32).reshape(1, 768, ref["refSslT"])

w, sr = torchaudio.load(os.path.join(REF_DIR, ref["audio"]))
if w.shape[0] > 1: w = w.mean(0, keepdim=True)
a32 = torchaudio.functional.resample(w, sr, 32000).float().numpy()
ref_audio = a32.reshape(1, -1)

x, prompts = s_enc.run(None, {
    "ref_seq": ref_seq, "text_seq": text_seq,
    "ref_bert": ref_bert, "text_bert": text_bert, "ssl_content": ssl_arr})
y, k, v, y_emb, x_ex = s_fsd.run(None, {"x": x.astype(np.float32), "prompts": prompts.astype(np.int64)})
EOS = 1024
for step in range(600):
    y, k, v, y_emb, logits, samples = s_sdc.run(None, {
        "iy": y.astype(np.int64), "ik": k.astype(np.float32), "iv": v.astype(np.float32),
        "iy_emb": y_emb.astype(np.float32), "ix_example": x_ex.astype(np.float32)})
    tok_i = int(samples.reshape(-1)[0])
    if tok_i == EOS or int(np.argmax(logits.reshape(-1))) == EOS:
        break
y2 = y.astype(np.int64).copy(); y2[0, -1] = 0
pred = y2[None, :, :]
audio = s_vits.run(None, {"text_seq": text_seq, "pred_semantic": pred, "ref_audio": ref_audio})[0]
audio = np.squeeze(audio)
print("  steps=%d audio=%s range=[%.3f,%.3f]" % (step, audio.shape, audio.min(), audio.max()), flush=True)
import wave
wv = wave.open("F:/TTSAI/tune/onnx_e2e_happy.wav", "wb")
wv.setnchannels(1); wv.setsampwidth(2); wv.setframerate(32000)
wv.writeframes((np.clip(audio, -1, 1) * 32767).astype("<i2").tobytes()); wv.close()

from sv import SV
sv = SV("cuda" if torch.cuda.is_available() else "cpu", False)
with torch.no_grad():
    e = sv.compute_embedding3(torchaudio.functional.resample(torch.from_numpy(audio[None, :]).float(), 32000, 16000).to(sv.embedding_model.device if hasattr(sv.embedding_model, 'device') else "cpu"))[0].float().cpu()
cent = torch.load("F:/TTSAI/tune/nori_voice_centroid.pt", map_location="cpu")["centroid"]
e2 = e / e.norm(); c2 = cent / cent.norm()
print("  TIMBRE SIM = %.4f" % float((e2 * c2).sum()), flush=True)
print("BUILD+VALIDATE DONE in %.1fs" % (time.time() - t0), flush=True)
