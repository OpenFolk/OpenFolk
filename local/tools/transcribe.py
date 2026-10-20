"""Transcribes voice messages locally with faster-whisper.

Runs as a service of the backend (local/src/voice.ts): reads one JSON {"id", "path", "language"} per line from stdin
and writes one {"id", "text", "language", "duration"} or {"id", "error"} per line to stdout. The model
stays loaded between jobs. At start it reports {"ready": true, "model", "device"}.

Environment, set by the backend from the machine settings: WHISPER_MODEL (default large-v3-turbo),
WHISPER_DEVICE (auto|cuda|cpu). The language comes with each job (e.g. en or de; empty = detect automatically),
for the single test from WHISPER_LANGUAGE. The Python environment needs faster-whisper and PyAV,
for a graphics card also the CUDA libraries (nvidia-cublas, nvidia-cudnn wheels).

Single test:  python transcribe.py --file recording.webm
"""

import json
import os
import site
import sys


def report(**msg):
    sys.stdout.write(json.dumps(msg, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def cuda_dlls():
    # cuBLAS/cuDNN from the pip wheels, so CTranslate2 finds them without a CUDA toolkit.
    for sp in site.getsitepackages():
        for sub in ("nvidia/cublas/bin", "nvidia/cudnn/bin"):
            p = os.path.join(sp, sub)
            if os.path.isdir(p):
                os.add_dll_directory(p)
                os.environ["PATH"] = p + os.pathsep + os.environ["PATH"]


def load_model():
    cuda_dlls()
    import ctranslate2
    from faster_whisper import WhisperModel

    name = os.environ.get("WHISPER_MODEL", "large-v3-turbo")
    wanted = os.environ.get("WHISPER_DEVICE", "auto")
    gpu = wanted == "cuda" or (wanted == "auto" and ctranslate2.get_cuda_device_count() > 0)
    if gpu:
        return WhisperModel(name, device="cuda", compute_type="float16"), name, "cuda"
    # Without a graphics card large is too slow: then a smaller model, unless one is set
    if "WHISPER_MODEL" not in os.environ:
        name = "small"
    return WhisperModel(name, device="cpu", compute_type="int8"), name, "cpu"


def decode(path):
    """Any recording (WebM/Opus, M4A/AAC, WAV …) to 16 kHz mono float32.

    Own decoding instead of faster-whisper's: its av.open(..., metadata_errors=…) is no longer
    known to PyAV from version 15.
    """
    import av
    import numpy as np

    parts = []
    with av.open(path, mode="r") as container:
        resampler = av.AudioResampler(format="s16", layout="mono", rate=16000)
        for frame in container.decode(audio=0):
            for out in resampler.resample(frame):
                parts.append(out.to_ndarray().reshape(-1))
        for out in resampler.resample(None):
            parts.append(out.to_ndarray().reshape(-1))
    if not parts:
        return np.zeros(0, dtype=np.float32)
    return np.concatenate(parts).astype(np.float32) / 32768.0


def transcribe(model, path, language=None):
    language = language or os.environ.get("WHISPER_LANGUAGE", "") or None
    segments, info = model.transcribe(decode(path), language=language, vad_filter=True, beam_size=5)
    text = " ".join(s.text.strip() for s in segments).strip()
    return {"text": text, "language": info.language, "duration": round(info.duration, 2)}


def main():
    if len(sys.argv) == 3 and sys.argv[1] == "--file":
        model, name, device = load_model()
        report(model=name, device=device, **transcribe(model, sys.argv[2]))
        return

    try:
        model, name, device = load_model()
    except Exception as e:  # noqa: BLE001 - the error goes to the backend as a message
        report(ready=False, error=f"Whisper cannot be loaded: {e}")
        return
    report(ready=True, model=name, device=device)

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        job = {}
        try:
            job = json.loads(line)
            report(id=job["id"], **transcribe(model, job["path"], job.get("language")))
        except Exception as e:  # noqa: BLE001
            report(id=job.get("id"), error=str(e))


if __name__ == "__main__":
    main()
