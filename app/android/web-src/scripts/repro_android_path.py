import os, sys, io, json
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")
repo = "F:/TTSAI/GPT-SoVITS-v2pro-20250604"
os.chdir(repo)
sys.path.insert(0, repo)
sys.path.insert(0, repo + "/GPT_SoVITS")
import numpy as np
import onnxruntime as ort

D = "onnx/nori"
TD = "F:/Nori-Desktop-Pet/app/android/app/src/main/assets/tts_data"
REF = "F:/Nori-Desktop-Pet/app/android/app/src/main/assets/ref"
TEXT = "嗨我是Nori能听到我的声音吗"

prov = ["CPUExecutionProvider"]
so = ort.SessionOptions(); so.intra_op_num_threads = 4
def sess(p): return ort.InferenceSession(p, sess_options=so, providers=prov)

s_ro = sess(os.path.join(D, "nori_roberta_int8.onnx"))
s_enc = sess(os.path.join(D, "nori_t2s_encoder_fp32.onnx"))
s_fsd = sess("F:/Nori-Desktop-Pet/app/android/app/src/std/assets/tts/nori_t2s_fsdec_int8.onnx")
s_sdc = sess("F:/Nori-Desktop-Pet/app/android/app/src/std/assets/tts/nori_t2s_sdec_int8.onnx")
s_vit = sess(os.path.join(D, "nori_vits_fp32.onnx"))

sym = json.load(open(TD + "/symbols.json", encoding="utf-8"))
sym2id = {s: i for i, s in enumerate(sym)}
chars = {}
for line in open(TD + "/pinyin.tsv", encoding="utf-8"):
    i = line.find("\t")
    if i > 0: chars[line[:i]] = line[i+1:].split()
vocab = json.load(open(TD + "/roberta_vocab.json", encoding="utf-8"))
refs = json.load(open(TD + "/refs.json", encoding="utf-8"))
ref = next(r for r in refs if r["name"] == "gentleness")

cleaned = TEXT
phs = []; w2p = []
for ch in cleaned:
    p = chars.get(ch)
    if p: phs.extend(p); w2p.append(len(p))
text_seq = np.array([[sym2id[x] for x in phs if x in sym2id]], np.int64)
print("text_seq", text_seq.shape)

ids = np.array([[vocab["[CLS]"]] + [vocab.get(ch, vocab["[UNK]"]) for ch in cleaned] + [vocab["[SEP]"]]], np.int64)
feat = s_ro.run(None, {"input_ids": ids})[0][0]        # [T,1024]
rows = []
for i, k in enumerate(w2p):
    rows.extend([feat[i]] * k)
text_bert = np.asarray(rows, np.float32)
print("bert", text_bert.shape)

ref_bert = np.fromfile(os.path.join(TD, ref["refBertFile"]), np.float32).reshape(ref["refBertRows"], 1024)
ref_ssl = np.fromfile(os.path.join(TD, ref["refSslFile"]), np.float32).reshape(1, 768, ref["refSslT"])

import soundfile as sf
pcm, sr0 = sf.read(os.path.join(REF, ref["audio"]), dtype="float32", always_2d=True)
pcm = pcm.mean(axis=1)
def resample_linear(x, frm, to):
    n = int(len(x) * to / frm); out = np.zeros(n, np.float32)
    step = frm / to; src = 0.0
    for i in range(n):
        i0 = int(src); f = src - i0
        a = x[i0] if i0 < len(x) else 0.0
        b = x[i0+1] if i0+1 < len(x) else a
        out[i] = a + (b - a) * f; src += step
    return out
ref32 = resample_linear(pcm, sr0, 32000)

x, prompts = s_enc.run(None, {
    "ref_seq": np.array([ref["refSeq"]], np.int64),
    "text_seq": text_seq,
    "ref_bert": ref_bert, "text_bert": text_bert, "ssl_content": ref_ssl})

EOS = 1024
y, k, v, y_emb, x_ex = s_fsd.run(None, {"x": x, "prompts": prompts})
print("fsdec y", y.shape, y.dtype, "k", k.shape, k.dtype, "y_emb", y_emb.shape, "x_ex", x_ex.shape)

steps = 0
while steps < 600:
    out_names = [o.name for o in s_sdc.get_outputs()]
    res = s_sdc.run(None, {"iy": y.astype(np.int64), "ik": k.astype(np.float32), "iv": v.astype(np.float32),
                           "iy_emb": y_emb.astype(np.float32), "ix_example": x_ex.astype(np.float32)})
    y, k, v, y_emb, logits, samples = res
    steps += 1
    if samples.reshape(-1)[0] == EOS or int(np.argmax(logits.reshape(-1))) == EOS:
        break
print("AR steps", steps)

y2 = y.astype(np.int64).copy()
if y2.size: y2.reshape(-1)[-1] = 0
pred = y2.reshape(1, 1, -1)
audio = s_vit.run(None, {"text_seq": text_seq, "pred_semantic": pred, "ref_audio": ref32.reshape(1, -1)})[0].reshape(-1)
print("audio", audio.shape, "min", audio.min(), "max", audio.max())

import wave
out = "F:/TTSAI/tune/android_path_repro.wav"
wv = wave.open(out, "wb"); wv.setnchannels(1); wv.setsampwidth(2); wv.setframerate(32000)
wv.writeframes((np.clip(audio, -1, 1) * 32767).astype("<i2").tobytes()); wv.close()
print("WROTE", out, round(len(audio)/32000, 2), "s")
