import os, sys
# 用法: 在导出目录对 t2s 解码器追加 Identity 输出节点(out_0..),
# 规避 ORT Java 对部分导出模型 "output name cannot be empty" 的运行时错误。
# 幂等: 已有 out_N 输出的文件自动跳过。
import onnx
from onnx import helper

D = "F:/TTSAI/GPT-SoVITS-v2pro-20250604/onnx/nori"
targets = [
    (os.path.join(D, "mix6/nori_t2s_fsdec_int8.onnx"), ["y", "k", "v", "y_emb", "x_example"]),
    (os.path.join(D, "mix6/nori_t2s_sdec_int8.onnx"), ["y", "k", "v", "y_emb", "logits", "samples"]),
    (os.path.join(D, "nori_t2s_fsdec_fp32.onnx"), ["y", "k", "v", "y_emb", "x_example"]),
    (os.path.join(D, "nori_t2s_sdec_fp32.onnx"), ["y", "k", "v", "y_emb", "logits", "samples"]),
]
for path, orig in targets:
    if not os.path.exists(path):
        print("skip missing", path)
        continue
    m = onnx.load(path)
    existing = {o.name for o in m.graph.output}
    if "out_0" in existing:
        print("already ok:", os.path.basename(path))
        continue
    for i, old in enumerate(orig):
        m.graph.node.append(helper.make_node("Identity", [old], ["out_%d" % i]))
    onnx.checker.check_model(m)
    onnx.save(m, path)
    print("fixed", os.path.basename(path), "->", ["out_%d" % i for i in range(len(orig))])
