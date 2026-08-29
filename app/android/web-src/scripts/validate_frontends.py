import os, sys, io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")
repo = "F:/TTSAI/GPT-SoVITS-v2pro-20250604"
os.chdir(repo)
sys.path.insert(0, repo)
sys.path.insert(0, repo + "/GPT_SoVITS")
import numpy as np
import torch, torchaudio
import onnxruntime as ort

D = "onnx/nori"
REF = "F:/Nori-Desktop-Pet/app/android/app/src/main/assets/ref/happy.wav"

def cos(a, b):
    a = a.flatten(); b = b.flatten()
    return float((a @ b) / (np.linalg.norm(a) * np.linalg.norm(b) + 1e-9))

from onnxruntime.quantization import quantize_dynamic, QuantType
dst = os.path.join(D, "nori_hubert_int8.onnx")
print("requantize hubert (MatMul/Gemm only) ...", flush=True)
quantize_dynamic(
    os.path.join(D, "nori_hubert.onnx"), dst,
    weight_type=QuantType.QInt8, per_channel=True,
    op_types_to_quantize=["MatMul", "Gemm"],
)
print("  size: %.1f MB" % (os.path.getsize(dst) / 1e6), flush=True)

from feature_extractor import cnhubert
cnhubert.cnhubert_base_path = repo + "/GPT_SoVITS/pretrained_models/chinese-hubert-base"
hubert_torch = cnhubert.get_model().model.eval()

w, sr = torchaudio.load(REF)
if w.shape[0] > 1: w = w.mean(0, keepdim=True)
w16 = torchaudio.functional.resample(w, sr, 16000).float()
with torch.no_grad():
    ref_ssl = hubert_torch(w16)["last_hidden_state"].numpy()
print("torch hubert out:", ref_ssl.shape, flush=True)

from transformers import AutoTokenizer, AutoModel
rdir = repo + "/GPT_SoVITS/pretrained_models/chinese-roberta-wwm-ext-large"
tok = AutoTokenizer.from_pretrained(rdir)
rmodel = AutoModel.from_pretrained(rdir).eval()
text = "太好了！我早就猜到你会这么说了，真的特别开心！"
with torch.no_grad():
    enc = tok(text, return_tensors="pt")
    ref_bert = rmodel(**enc).last_hidden_state.numpy()
print("torch roberta out:", ref_bert.shape, "tokens:", enc["input_ids"].shape, flush=True)

prov = ["CPUExecutionProvider"]
opts = ort.SessionOptions()
opts.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL

s = ort.InferenceSession(dst, sess_options=opts, providers=prov)
print("hubert int8 inputs:", [(i.name, i.shape) for i in s.get_inputs()], flush=True)
x = w16.numpy()
feed = {s.get_inputs()[0].name: x}
out = s.run(None, feed)[0]
print("onnx hubert out:", out.shape, "cos vs torch = %.6f" % cos(out, ref_ssl), flush=True)

s2 = ort.InferenceSession(os.path.join(D, "nori_roberta_int8.onnx"), sess_options=opts, providers=prov)
print("roberta int8 inputs:", [(i.name, i.shape, i.type) for i in s2.get_inputs()], flush=True)
feed2 = {}
for i in s2.get_inputs():
    n = i.name
    if n in enc:
        feed2[n] = enc[n].numpy().astype(np.int64 if "int" in i.type else np.float32)
    else:
        print("  !! roberta input not in enc:", n, i.shape)
out2 = s2.run(None, feed2)[0]
print("onnx roberta out:", out2.shape, "cos vs torch = %.6f" % cos(out2, ref_bert), flush=True)
print("VALIDATION DONE", flush=True)
