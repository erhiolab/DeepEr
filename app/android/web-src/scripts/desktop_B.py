import os, sys, json
repo = "F:/TTSAI/GPT-SoVITS-v2pro-20250604"
os.chdir(repo)
sys.path.insert(0, repo + "/GPT_SoVITS")
sys.path.insert(0, repo)
import numpy as np, torch, torchaudio, onnxruntime as ort
torch.set_num_threads(4)

PREF = "F:/Nori-Desktop-Pet/app/android/app/src/main/assets/ref"
ONNX = repo + "/onnx/nori/mix6"

# ---- 前端：文本/参考音频 → 条件特征 ----
from inference_webui import get_phones_and_bert
from feature_extractor import cnhubert
cnhubert.cnhubert_base_path = repo + "/GPT_SoVITS/pretrained_models/chinese-hubert-base"
ssl = cnhubert.get_model().model

refs = json.load(open(os.path.join(PREF, "refs.json"), encoding="utf-8"))
ref = next(r for r in refs if r["name"] == "happy")

def load16k(path):
    w, sr = torchaudio.load(path)
    if w.shape[0] > 1: w = w.mean(0, keepdim=True)
    return torchaudio.functional.resample(w, sr, 16000).float()

ref_audio_wav = load16k(os.path.join(PREF, ref["audio"]))
with torch.no_grad():
    ssl_content = ssl(ref_audio_wav)["last_hidden_state"].transpose(1, 2).float()

ref_seq_id, ref_bert_T, _ = get_phones_and_bert(ref["prompt"], "all_zh", "v2")
text = "你好呀，今天过得好吗？我好想你呀。"
text_seq_id, text_bert_T, _ = get_phones_and_bert(text, "all_zh", "v2")

ref_seq = np.array([ref_seq_id], np.int64)
text_seq = np.array([text_seq_id], np.int64)
ref_bert = np.asarray(ref_bert_T.T.detach().cpu(), np.float32)
text_bert = np.asarray(text_bert_T.T.detach().cpu(), np.float32)
ssl_arr = np.asarray(ssl_content.numpy(), np.float32)
ref_audio_32k = torchaudio.functional.resample(ref_audio_wav, 16000, 32000)
ref_audio_32k_np = np.asarray(ref_audio_32k.numpy(), np.float32)

print("shapes:", ref_seq.shape, text_seq.shape, ref_bert.shape, text_bert.shape, ssl_arr.shape)

prov = ["CPUExecutionProvider"]
def sess(f): return ort.InferenceSession(os.path.join(ONNX, f), providers=prov)
enc = sess("nori_t2s_encoder_fp32.onnx")
fsd = sess("nori_t2s_fsdec_int8.onnx")
sdc = sess("nori_t2s_sdec_int8.onnx")
vit = sess("nori_vits_fp32.onnx")

x, prompts = enc.run(None, {
    "ref_seq": ref_seq, "text_seq": text_seq,
    "ref_bert": ref_bert, "text_bert": text_bert, "ssl_content": ssl_arr,
})
print("enc x", x.shape, "prompts", prompts.shape)
y, k, v, y_emb, x_ex = fsd.run(None, {"x": x.astype(np.float32), "prompts": prompts.astype(np.int64)})
print("fsdec y", y.shape, "k", k.shape)
EOS = 1024
step = 0
for step in range(300):
    y, k, v, y_emb, logits, samples = sdc.run(None, {
        "iy": y.astype(np.int64), "ik": k.astype(np.float32), "iv": v.astype(np.float32),
        "iy_emb": y_emb.astype(np.float32), "ix_example": x_ex.astype(np.float32),
    })
    tok = int(samples.reshape(-1)[0])
    logtop = int(np.argmax(logits.reshape(-1)))
    if tok == EOS or logtop == EOS:
        break
print("GPT loop steps:", step, "final y len", y.shape[1])

# pred_semantic: 去掉可能 EOS 的尾部, 形状 [1,1,T]
y2 = y.astype(np.int64).copy()
y2[0, -1] = 0
pred = y2[None, :, :]  # [1,1,T]
audio = vit.run(None, {"text_seq": text_seq, "pred_semantic": pred, "ref_audio": ref_audio_32k_np})[0]
audio = np.squeeze(audio)
print("audio", audio.shape, audio.min(), audio.max())
out = "F:/TTSAI/nori_tts_sample.wav"
torchaudio.save(out, torch.from_numpy(audio[None, :]).float(), 32000)
print("WROTE", out, "dur", round(audio.shape[0]/32000, 2), "s")