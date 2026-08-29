import os, sys, io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")
import onnx

D = "F:/TTSAI/GPT-SoVITS-v2pro-20250604/onnx/nori"
files = [
    "nori_roberta_int8.onnx",
    "nori_t2s_encoder_fp32.onnx",
    "nori_t2s_fsdec_fp32.onnx", "nori_t2s_fsdec_int8.onnx",
    "nori_t2s_sdec_fp32.onnx", "nori_t2s_sdec_int8.onnx",
    "nori_vits_fp32.onnx",
]
for f in files:
    p = os.path.join(D, f)
    if not os.path.exists(p):
        print("skip missing", f)
        continue
    m = onnx.load(p)
    changed = False
    for i, o in enumerate(m.graph.output):
        if not o.name:
            o.name = "out_%d" % i
            changed = True
    if changed:
        onnx.save(m, p)
        print("renamed outputs:", f, [o.name for o in m.graph.output])
    else:
        print("ok:", f, [o.name for o in m.graph.output])
print("DONE")
