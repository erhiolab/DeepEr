import os
os.environ["CUDA_VISIBLE_DEVICES"] = ""
import sys, io, json, torch
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
repo = "F:/TTSAI/GPT-SoVITS-v2pro-20250604"; os.chdir(repo)
sys.path.insert(0, repo + "/GPT_SoVITS"); sys.path.insert(0, repo)
torch.set_num_threads(4)

# stub my_utils (export_torch_script imports it but we don't need load_audio)
import types
mu = types.ModuleType("my_utils"); mu.load_audio = lambda *a, **k: (_ for _ in ()).throw(NotImplementedError)
sys.modules["my_utils"] = mu

from export_torch_script import VitsModel, get_raw_t2s_model, T2SModel, ExportERes2NetV2
from inference_webui import get_phones_and_bert
from feature_extractor import cnhubert
cnhubert.cnhubert_base_path = repo + "/GPT_SoVITS/pretrained_models/chinese-hubert-base"
ssl = cnhubert.get_model().model
from sv import SV
svc = SV("cpu", False)
sv_model = ExportERes2NetV2(svc)

REFNAME = sys.argv[1] if len(sys.argv) > 1 else "happy"
TOP_K = int(sys.argv[2]) if len(sys.argv) > 2 else 5
TEXT = sys.argv[3] if len(sys.argv) > 3 else "你好呀，今天过得好吗？我好想你呀。"
OUTNAME = sys.argv[4] if len(sys.argv) > 4 else "nori_v2pro_sample"

REF = "F:/Nori-Desktop-Pet/app/android/app/src/main/assets/ref"
refs = json.load(open(REF + "/refs.json", encoding="utf-8"))
ref = next(r for r in refs if r["name"] == REFNAME)
import torchaudio
def load16k(p):
    w, sr = torchaudio.load(p)
    if w.shape[0] > 1: w = w.mean(0, keepdim=True)
    return torchaudio.functional.resample(w, sr, 16000).float()
audio16k = load16k(REF + "/" + ref["audio"])

with torch.no_grad():
    sslc = ssl(audio16k)["last_hidden_state"].transpose(1, 2).float()

ref_seq_id, ref_bert_T, _ = get_phones_and_bert(ref["prompt"], "all_zh", "v2")
text = TEXT
text_seq_id, text_bert_T, _ = get_phones_and_bert(text, "all_zh", "v2")
ref_seq = torch.LongTensor([ref_seq_id]); text_seq = torch.LongTensor([text_seq_id])
ref_bert = ref_bert_T.T.float(); text_bert = text_bert_T.T.float()
print("seq", ref_seq.shape, text_seq.shape, "bert", ref_bert.shape, text_bert.shape)

vits = VitsModel("F:/TTSAI/nori_e44_s1760.pth", "v2Pro", is_half=False, device="cpu"); vits.eval()
sd = torch.load("F:/TTSAI/nori-e98.ckpt", map_location="cpu", weights_only=False)
raw = get_raw_t2s_model(sd)
t2s = T2SModel(raw); t2s = t2s.cpu(); t2s.eval()

with torch.no_grad():
    codes = vits.vq_model.extract_latent(sslc)
    prompts = codes[0, 0].unsqueeze(0)
    print("prompts", prompts.shape)
    audio32k = torchaudio.functional.resample(audio16k, 16000, 32000)
    audio16k2 = torchaudio.functional.resample(audio32k, 32000, 16000)
    sv_emb = sv_model(audio16k2)
    print("sv_emb", sv_emb.shape)
    top_k = torch.LongTensor([TOP_K])
    pred = t2s(prompts, ref_seq, text_seq, ref_bert, text_bert, top_k)
    print("pred", pred.shape, "top_k", TOP_K)
    audio = vits(text_seq, pred, audio32k, 1.0, sv_emb)
out = "F:/TTSAI/" + OUTNAME + ".wav"
torchaudio.save(out, audio.unsqueeze(0).float().cpu(), int(vits.hps.data.sampling_rate))
print("WROTE", out, "sr", int(vits.hps.data.sampling_rate), "dur", round(audio.shape[0] / int(vits.hps.data.sampling_rate), 2))