import os, sys
repo = "F:/TTSAI/GPT-SoVITS-v2pro-20250604"
os.chdir(repo)
sys.path.insert(0, repo + "/GPT_SoVITS")
sys.path.insert(0, repo)
import torch
torch.set_num_threads(4)

v2pro = repo + "/GPT_SoVITS/pretrained_models/v2Pro/s2Gv2Pro.pth"
v2 = repo + "/GPT_SoVITS/pretrained_models/gsv-v2final-pretrained/s2G2333k.pth"
gptf = "C:/Users/Administrator/Downloads/nori-e113.ckpt"

from onnx_export import VitsModel, T2SModel

vits = None
for label, vpath in [("v2Pro", v2pro), ("v2", v2)]:
    try:
        v = VitsModel(vpath)
        md = v.hps.get("model", {}) if isinstance(v.hps, dict) else getattr(v.hps, "model", {})
        dd = v.hps.get("data", {}) if isinstance(v.hps, dict) else getattr(v.hps, "data", {})
        print("== %s VitsModel OK  version=%s  sr=%s" % (label, md.get("version"), dd.get("sampling_rate")))
        if vits is None:
            vits = (label, v)
    except Exception as e:
        print("== %s FAIL: %s %s" % (label, type(e).__name__, str(e)[:140]))

if vits:
    label, vits_model = vits
    print("== GPT build with", label, "vits ==")
    try:
        g = T2SModel(gptf, vits_model)
        print("T2S build OK num_layers", g.t2s_model.num_layers, "embed_dim", g.t2s_model.embedding_dim)
    except Exception as e:
        import traceback; print("T2S FAIL:", type(e).__name__, str(e)[:200])