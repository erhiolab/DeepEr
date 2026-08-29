import os, shutil
from onnxruntime.quantization import quantize_dynamic, QuantType
from onnxruntime.quantization.shape_inference import quant_pre_process

SRC = "F:/TTSAI/GPT-SoVITS-v2pro-20250604/onnx/nori"
OUT = SRC  # 在 nori 下建子目录

FILES = ["nori_t2s_encoder.onnx", "nori_t2s_fsdec.onnx", "nori_t2s_sdec.onnx", "nori_vits.onnx"]

def q8(name, dst):
    quantize_dynamic(os.path.join(SRC, name), dst, weight_type=QuantType.QInt8, per_channel=True)
    print("int8  %-28s %.1f MB" % (name, os.path.getsize(dst)/1e6))

# 预处理(形状推断+融合)可让动态量化在复杂图上不误判
os.makedirs(os.path.join(OUT, "_pre"), exist_ok=True)
pre_files = {}
for f in FILES:
    pp = os.path.join(OUT, "_pre", f)
    try:
        quant_pre_process(os.path.join(SRC, f), pp)
        pre_files[f] = pp
    except Exception as e:
        print("pre fail", f, e); pre_files[f] = os.path.join(SRC, f)

# 4G 档: 全部 int8(基于预处理后的图)
for f in FILES:
    dst = os.path.join(OUT, "int8", f); os.makedirs(os.path.dirname(dst), exist_ok=True)
    quantize_dynamic(pre_files[f], dst, weight_type=QuantType.QInt8, per_channel=True)
    print("int8  %-28s %.1f MB" % (f, os.path.getsize(dst)/1e6))

# 6G 档: GPT(fsdec/sdec) int8, 声码器/encoder 保留 fp32
mix = os.path.join(OUT, "mix6"); os.makedirs(mix, exist_ok=True)
for n in ["nori_t2s_encoder.onnx", "nori_vits.onnx"]:
    shutil.copy(os.path.join(SRC,n), os.path.join(mix,n))
for n in ["nori_t2s_fsdec.onnx", "nori_t2s_sdec.onnx"]:
    quantize_dynamic(os.path.join(SRC,n), os.path.join(mix,n), weight_type=QuantType.QInt8, per_channel=True)
print("mix6 done")

print("\nsizes by tier:")
def size(dirpath):
    return sum(os.path.getsize(os.path.join(dirpath,f)) for f in os.listdir(dirpath) if f.endswith(".onnx"))/1e6
print(" fp32 (12/16G): %7.1f MB" % size(SRC))
print(" int8 (4G)    : %7.1f MB" % size(os.path.join(OUT,"int8")))
print(" mix6 (6G)    : %7.1f MB" % size(mix))