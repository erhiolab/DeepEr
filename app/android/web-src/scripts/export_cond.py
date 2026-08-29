import os, torch
torch.set_num_threads(4)

P = "F:/TTSAI/GPT-SoVITS-v2pro-20250604/GPT_SoVITS/pretrained_models"
OUT = "F:/TTSAI/GPT-SoVITS-v2pro-20250604/onnx/nori"
os.makedirs(OUT, exist_ok=True)

from transformers import AutoModel, AutoConfig

# ---- RoBERTa → text_bert ----
print("== export RoBERTa ==")
cfg = AutoConfig.from_pretrained(os.path.join(P, "chinese-roberta-wwm-ext-large"))
print("  type:", cfg.architectures, "hidden:", cfg.hidden_size, "vocab:", cfg.vocab_size)
m = AutoModel.from_pretrained(os.path.join(P, "chinese-roberta-wwm-ext-large"))
m.eval()
dummy = torch.ones(1, 16, dtype=torch.long)
with torch.no_grad():
    da = m(dummy)["last_hidden_state"]
torch.onnx.export(m, (dummy,), os.path.join(OUT, "nori_roberta.onnx"),
    input_names=["input_ids"], output_names=["last_hidden"],
    dynamic_axes={"input_ids": {1: "N"}, "last_hidden": {1: "N"}},
    opset_version=16)
print("  roberta state:", tuple(da.shape), "-> ok")

# ---- HuBERT → ssl_content ----
print("== export HuBERT ==")
cfg2 = AutoConfig.from_pretrained(os.path.join(P, "chinese-hubert-base"))
print("  type:", cfg2.architectures, "hidden:", cfg2.hidden_size)
m2 = AutoModel.from_pretrained(os.path.join(P, "chinese-hubert-base"))
m2.eval()
dummy2 = torch.randn(1, 16000)
with torch.no_grad():
    db = m2(dummy2)["last_hidden_state"]
torch.onnx.export(m2, (dummy2,), os.path.join(OUT, "nori_hubert.onnx"),
    input_names=["input_values"], output_names=["last_hidden"],
    dynamic_axes={"input_values": {1: "T"}, "last_hidden": {1: "T"}},
    opset_version=16)
print("  hubert state:", tuple(db.shape), "-> ok")

for f in ["nori_roberta.onnx", "nori_hubert.onnx"]:
    print(f, "%.1f MB" % (os.path.getsize(os.path.join(OUT, f)) / 1e6))