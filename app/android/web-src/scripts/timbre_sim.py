import os, sys, io, json, glob
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")
repo = "F:/TTSAI/GPT-SoVITS-v2pro-20250604"
os.chdir(repo)
sys.path.insert(0, repo)
sys.path.insert(0, repo + "/GPT_SoVITS")

import torch
import torchaudio
from sv import SV

REF_DIR = "F:/Nori-Desktop-Pet/app/android/app/src/main/assets/ref"
TRAIN_DIR = "F:/TTSAI/训练素材/音频"

def load16k(path):
    try:
        w, sr = torchaudio.load(path)
    except Exception:
        import soundfile as sf
        data, sr = sf.read(path, dtype="float32", always_2d=True)
        w = torch.from_numpy(data.T)
    if w.shape[0] > 1:
        w = w.mean(0, keepdim=True)
    if sr != 16000:
        w = torchaudio.functional.resample(w, sr, 16000)
    return w

def cos(a, b):
    a = a / a.norm(dim=-1, keepdim=True).clamp_min(1e-8)
    b = b / b.norm(dim=-1, keepdim=True).clamp_min(1e-8)
    return float((a * b).sum())

def main():
    dev = "cuda" if torch.cuda.is_available() else "cpu"
    print("device:", dev)
    sv = SV(dev, False)

    with torch.no_grad():
        def embed(path):
            w = load16k(path).to(dev)
            return sv.compute_embedding3(w)[0].float().cpu()

    refs = json.load(open(os.path.join(REF_DIR, "refs.json"), encoding="utf-8"))
    ref_emb = {}
    for r in refs:
        ref_emb[r["name"]] = embed(os.path.join(REF_DIR, r["audio"]))
    print("embedded %d refs" % len(ref_emb))

    names = sorted(ref_emb)
    sims = [cos(ref_emb[a], ref_emb[b]) for i, a in enumerate(names) for b in names[i + 1:]]
    print("ref↔ref cos: mean %.4f min %.4f max %.4f" % (
        sum(sims) / len(sims), min(sims), max(sims)))

    train = sorted(glob.glob(os.path.join(TRAIN_DIR, "*.mp3")))
    if not train:
        train = sorted(glob.glob(os.path.join(TRAIN_DIR, "*.wav")))
    tr = []
    with torch.no_grad():
        for i, p in enumerate(train):
            try:
                tr.append(embed(p))
            except Exception as e:
                print("  skip", os.path.basename(p), e)
    tr_stack = torch.stack(tr)
    print("embedded %d training clips" % len(tr_stack))
    centroid = tr_stack.mean(0)
    tr_sims = [cos(e, centroid) for e in tr_stack]
    print("train↔centroid cos: mean %.4f min %.4f max %.4f" % (
        sum(tr_sims) / len(tr_sims), min(tr_sims), max(tr_sims)))
    ref_cent = cos(torch.stack([ref_emb[n] for n in names]).mean(0), centroid)
    print("refCentroid↔trainCentroid cos: %.4f" % ref_cent)

    torch.save({"centroid": centroid}, "F:/TTSAI/tune/nori_voice_centroid.pt")

    for p in sys.argv[1:]:
        try:
            e = embed(p)
        except Exception as ex:
            print("%-40s ERR %s" % (os.path.basename(p), ex))
            continue
        base = os.path.splitext(os.path.basename(p))[0].lower()
        per = {n: round(cos(e, v), 4) for n, v in ref_emb.items()}
        best = max(per.items(), key=lambda kv: kv[1])
        print("%-40s train=%.4f bestRef=%s(%.4f) matchRef=%s" % (
            os.path.basename(p), cos(e, centroid), best[0], best[1],
            per.get(base, "-")))

if __name__ == "__main__":
    main()
