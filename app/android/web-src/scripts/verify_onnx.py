import numpy as np, onnxruntime as ort, os
D = "F:/TTSAI/GPT-SoVITS-v2pro-20250604/onnx/nori"
prov = ["CPUExecutionProvider"]
opts = ort.SessionOptions(); opts.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL

print("=== t2s_encoder ===")
s = ort.InferenceSession(os.path.join(D,"nori_t2s_encoder.onnx"), sess_options=opts, providers=prov)
i = s.get_inputs(); print(" inputs:", [(x.name, x.shape, x.type) for x in i])
o = s.get_outputs(); print(" outputs:", [x.name for x in o])
r = np.random.default_rng(0)
feed = {
 "ref_seq": r.integers(0,700,(1,13)).astype(np.int64),
 "text_seq": r.integers(0,700,(1,24)).astype(np.int64),
 "ref_bert": r.standard_normal((13,1024)).astype(np.float32),
 "text_bert": r.standard_normal((24,1024)).astype(np.float32),
 "ssl_content": r.standard_normal((1,768,13)).astype(np.float32),
}
out = s.run(None, feed); print(" OK ->", [tuple(x.shape) for x in out])

print("=== t2s_fsdec ===")
s = ort.InferenceSession(os.path.join(D,"nori_t2s_fsdec.onnx"), sess_options=opts, providers=prov)
i = s.get_inputs(); print(" inputs:", [(x.name, x.shape) for x in i])
o = s.get_outputs(); print(" outputs:", [x.name for x in o])
x = np.zeros((1,13,512), np.float32); prompts = np.arange(3).reshape(1,3).astype(np.int64)
feed = {"x":x, "prompts":prompts}
out = s.run(None, feed); print(" OK ->", [tuple(a.shape) for a in out])

print("=== t2s_sdec ===")
s = ort.InferenceSession(os.path.join(D,"nori_t2s_sdec.onnx"), sess_options=opts, providers=prov)
i = s.get_inputs(); print(" inputs:", [(x.name, x.shape, x.type) for x in i])
import numpy as _np
n = _np.zeros
iy = n((1,5)); k = n((24,5,1,512)); v = n((24,5,1,512)); iy_emb = n((1,5,512)); ix_ex = n((1,5))
def arr(dt): 
    base = { "tensor(float)": _np.float32, "tensor(int64)": _np.int64, "tensor(int32)": _np.int32 }
    if "float" in dt: return _np.float32
    if "int" in dt: return _np.int64
    return _np.float32
feed = {
    "iy": iy.astype(arr(i[0].type)),
    "ik": k.astype(arr(i[1].type)),
    "iv": v.astype(arr(i[2].type)),
    "iy_emb": iy_emb.astype(arr(i[3].type)),
    "ix_example": ix_ex.astype(arr(i[4].type)),
}
out = s.run(None, feed); print(" OK ->", [tuple(a.shape) for a in out])

print("=== vits ===")
s = ort.InferenceSession(os.path.join(D,"nori_vits.onnx"), sess_options=opts, providers=prov)
i = s.get_inputs(); print(" inputs:", [(x.name, x.shape) for x in i])
o = s.get_outputs(); print(" outputs:", [x.name for x in o])
text_seq = r.integers(0,700,(1,24)).astype(np.int64)
pred = r.integers(1,25,(1,4,50)).astype(np.int64)  # 语义 token
ref_audio = r.standard_normal((1,160000)).astype(np.float32)
out = s.run(None, {"text_seq":text_seq,"pred_semantic":np.zeros((1,50),np.int64),"ref_audio":ref_audio})[0]
print(" audio shape:", out.shape, "range", float(out.min()), float(out.max()))
import wave, struct
w = wave.open("F:/TTSAI/_verify.wav","wb"); w.setnchannels(1); w.setsampwidth(2); w.setframerate(32000)
data = np.clip(out[0],-1,1)
w.writeframes((data*32767).astype('<i2').tobytes()); w.close()
print("wrote F:/TTSAI/_verify.wav", data.size)