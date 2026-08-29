import os, sys, io, json, time, traceback
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")
repo = "F:/TTSAI/GPT-SoVITS-v2pro-20250604"
os.chdir(repo)
sys.path.insert(0, repo)
sys.path.insert(0, repo + "/GPT_SoVITS")
import torch
import torchaudio
import types

_mu = types.ModuleType("my_utils")
_mu.load_audio = lambda *a, **k: (_ for _ in ()).throw(NotImplementedError)
sys.modules["my_utils"] = _mu

DEV = "cuda" if torch.cuda.is_available() else "cpu"
print("device:", DEV, flush=True)

REF = "F:/Nori-Desktop-Pet/app/android/app/src/main/assets/ref"
OUT = "F:/TTSAI/tune"
TEXT = "你好呀，今天过得好吗？我好想你呀。"

from export_torch_script import VitsModel, get_raw_t2s_model, T2SModel, ExportERes2NetV2
from inference_webui import get_phones_and_bert
from feature_extractor import cnhubert
from sv import SV
cnhubert.cnhubert_base_path = repo + "/GPT_SoVITS/pretrained_models/chinese-hubert-base"
ssl = cnhubert.get_model().model.to(DEV).eval()

vits = VitsModel("F:/TTSAI/nori_e44_s1760.pth", "v2Pro", is_half=False, device=DEV)
vits.eval()
sd = torch.load("F:/TTSAI/nori-e98.ckpt", map_location="cpu", weights_only=False)
raw = get_raw_t2s_model(sd).to(DEV).eval()
t2s = T2SModel(raw)
sv = ExportERes2NetV2(SV("cpu", False)).to(DEV).eval()
print("models ready", flush=True)

refs = json.load(open(REF + "/refs.json", encoding="utf-8"))

def load16k(p):
    w, sr = torchaudio.load(p)
    if w.shape[0] > 1: w = w.mean(0, keepdim=True)
    return torchaudio.functional.resample(w, sr, 16000).float()

def gen(emotion, top_k):
    ref = next(r for r in refs if r["name"] == emotion)
    with torch.no_grad():
        audio16k = load16k(os.path.join(REF, ref["audio"])).to(DEV)
        sslc = ssl(audio16k)["last_hidden_state"].transpose(1, 2).float()
        codes = vits.vq_model.extract_latent(sslc)
        prompts = codes[0, 0].unsqueeze(0)
        audio32k = torchaudio.functional.resample(audio16k, 16000, 32000)
        audio16k2 = torchaudio.functional.resample(audio32k, 32000, 16000)
        sv_emb = sv(audio16k2)
        ref_seq_id, ref_bert_T, _ = get_phones_and_bert(ref["prompt"], "all_zh", "v2")
        text_seq_id, text_bert_T, _ = get_phones_and_bert(TEXT, "all_zh", "v2")
        ref_seq = torch.LongTensor([ref_seq_id]).to(DEV)
        text_seq = torch.LongTensor([text_seq_id]).to(DEV)
        ref_bert = ref_bert_T.T.float().to(DEV)
        text_bert = text_bert_T.T.float().to(DEV)
        pred = t2s(prompts, ref_seq, text_seq, ref_bert, text_bert, torch.LongTensor([top_k]).to(DEV))
        audio = vits(text_seq, pred, audio32k, 1.0, sv_emb)
    sr = int(vits.hps.data.sampling_rate)
    out = os.path.join(OUT, "%s_tk%d.wav" % (emotion, top_k))
    torchaudio.save(out, audio.unsqueeze(0).float().cpu(), sr)
    return audio.shape[0] / sr

print("sv ready", flush=True)

plan = []
for k in (5, 10, 15, 20, 25, 30):
    plan.append(("happy", k))
for name in [r["name"] for r in refs]:
    plan.append((name, 10))

only = sys.argv[1] if len(sys.argv) > 1 else None
if only:
    plan = [(e, k) for e, k in plan if e == only]

for emotion, k in plan:
    path = os.path.join(OUT, "%s_tk%d.wav" % (emotion, k))
    if os.path.exists(path):
        print("skip", emotion, k, flush=True)
        continue
    t = time.time()
    try:
        dur = gen(emotion, k)
        print("gen %-12s tk%-3d %5.1fs audio %5.2fs" % (emotion, k, time.time() - t, dur), flush=True)
    except Exception as e:
        traceback.print_exc()
        print("FAIL", emotion, k, str(e)[:120], flush=True)
        if DEV == "cuda":
            torch.cuda.empty_cache()
print("SWEEP DONE", flush=True)
