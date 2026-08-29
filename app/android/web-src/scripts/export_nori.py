import os, sys, time
repo = "F:/TTSAI/GPT-SoVITS-v2pro-20250604"
os.chdir(repo)
sys.path.insert(0, repo + "/GPT_SoVITS")
sys.path.insert(0, repo)
import torch
torch.set_num_threads(4)
import torchaudio, soundfile

vits_path = repo + "/GPT_SoVITS/pretrained_models/gsv-v2final-pretrained/s2G2333k.pth"
gpt_path = "C:/Users/Administrator/Downloads/nori-e113.ckpt"
project = "nori"

from onnx_export import VitsModel, T2SModel, GptSoVits, SSLModel, cleaned_text_to_sequence

os.makedirs("onnx", exist_ok=True)
os.makedirs("onnx/" + project, exist_ok=True)

t = time.time()
print("build vits...")
vits = VitsModel(vits_path)
print("  ok %.1fs" % (time.time()-t)); t = time.time()
print("build gpt...")
gpt = T2SModel(gpt_path, vits)
print("  ok %.1fs" % (time.time()-t)); t = time.time()
gpt_sovits = GptSoVits(vits, gpt)
ssl = SSLModel()

vmodels = "v2"
ref_seq = torch.LongTensor([cleaned_text_to_sequence(["n","i2","h","ao3",",","w","o3","sh","i4","b","ai2","y","e4"], version=vmodels)])
text_seq = torch.LongTensor([cleaned_text_to_sequence(["w","o3","sh","i4","b","ai2","y","e4"]*3, version=vmodels)])
ref_bert = torch.randn((ref_seq.shape[1], 1024)).float()
text_bert = torch.randn((text_seq.shape[1], 1024)).float()
ref_audio = torch.randn((1, 48000*5)).float()
ref_audio_16k = torchaudio.functional.resample(ref_audio, 48000, 16000).float()
ref_audio_sr = torchaudio.functional.resample(ref_audio, 48000, int(vits.hps.data.sampling_rate)).float()
with torch.no_grad():
    ssl_content = ssl(ref_audio_16k).float()

print("exporting onnx to onnx/%s/ ..." % project); t = time.time()
with torch.no_grad():
    gpt_sovits.export(ref_seq, text_seq, ref_bert, text_bert, ref_audio_sr, ssl_content, project)
print("EXPORT DONE in %.1f s" % (time.time()-t))
print("files:")
for f in os.listdir("onnx/"+project):
    p = os.path.join("onnx/"+project, f)
    print("  %-24s %.1f MB" % (f, os.path.getsize(p)/1e6))