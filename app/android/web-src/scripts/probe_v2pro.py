import os, sys, io, torch
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
torch.set_num_threads(4)
repo = "F:/TTSAI/GPT-SoVITS-v2pro-20250604"
os.chdir(repo); sys.path.insert(0, repo + "/GPT_SoVITS"); sys.path.insert(0, repo)

print("torch", torch.__version__, "cuda", torch.cuda.is_available())
from module.models import SynthesizerTrn
from AR.models.t2s_lightning_module import Text2SemanticLightningModule

# ---- v2Pro SoVITS ----
vs = "F:/TTSAI/nori_e44_s1760.pth"
try:
    import config as config_mod
    hps = config_mod.get_hparams_from_file(repo + "/GPT_SoVITS/SoVITS_weights_v2/s2G2333k.pth" if False else vs) if False else None
except Exception as e:
    hps = None
# 用 VitsModel 方式读（含 hps 头）
from onnx_export import VitsModel
for version in ["v2", "v2Pro"]:
    try:
        v = VitsModel(vs, version=version, is_half=False, device="cpu")
        print("e44 load OK as", version, "sampling_rate", v.hps.data.sampling_rate)
        break
    except Exception as e:
        print("e44 as", version, "FAIL", str(e)[:200])