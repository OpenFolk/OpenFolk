"""Reads text aloud locally with Piper (the voice "on the bot's machine" in the settings).

Runs as a service of the backend (local/src/speech-local.ts): reads one JSON {"id", "text", "voice", "path"} per line
from stdin, writes the WAV to "path" and answers one {"id", "ok": true, "duration"} or {"id", "error"} per line on
stdout. The voices stay loaded between jobs. At start it reports {"ready": true} or {"ready": false, "error"}.

A voice (e.g. de_DE-thorsten-high) that is not on this machine yet is downloaded first from Hugging Face
(rhasspy/piper-voices, 60 to 120 MB); {"downloading": voice} says so, so the backend waits. PIPER_DATA_DIR is the
folder for the voices, set by the backend. The Python environment needs piper-tts (local/tools/requirements-voice.txt).

Single test:  python speak.py --voice de_DE-thorsten-high --text "Guten Tag." --out test.wav
"""

import json
import os
import sys
import wave
from pathlib import Path


def report(**msg):
    sys.stdout.write(json.dumps(msg, ensure_ascii=False) + "\n")
    sys.stdout.flush()


class Speaker:
    def __init__(self, data_dir):
        self.data_dir = Path(data_dir)
        self.data_dir.mkdir(parents=True, exist_ok=True)
        self.voices = {}

    def voice(self, name):
        """The loaded voice, downloaded first if it is not here yet."""
        if name in self.voices:
            return self.voices[name]
        from piper import PiperVoice
        from piper.download_voices import download_voice

        model = self.data_dir / f"{name}.onnx"
        if not model.exists() or not (self.data_dir / f"{name}.onnx.json").exists():
            report(downloading=name)
            download_voice(name, self.data_dir)
        self.voices[name] = PiperVoice.load(model, use_cuda=os.environ.get("PIPER_CUDA") == "1")
        return self.voices[name]

    def speak(self, text, name, path):
        """Writes the text as a WAV (22 kHz for the medium and high voices, 16 bit, mono); returns its length in s."""
        voice = self.voice(name)
        Path(path).parent.mkdir(parents=True, exist_ok=True)
        with wave.open(path, "wb") as wav:
            voice.synthesize_wav(text, wav)
        with wave.open(path, "rb") as wav:
            return round(wav.getnframes() / wav.getframerate(), 2)


def main():
    args = sys.argv[1:]
    if "--text" in args:
        get = lambda k, d=None: args[args.index(k) + 1] if k in args else d  # noqa: E731
        s = Speaker(os.environ.get("PIPER_DATA_DIR", "."))
        report(ok=True, duration=s.speak(get("--text"), get("--voice", "en_US-lessac-high"), get("--out", "out.wav")))
        return

    try:
        import piper  # noqa: F401 - only the check that the package is there
    except Exception as e:  # noqa: BLE001 - the error goes to the backend as a message
        report(ready=False, error=f"piper-tts is missing in this Python: {e}")
        return
    speaker = Speaker(os.environ.get("PIPER_DATA_DIR", "."))
    report(ready=True)

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        job = {}
        try:
            job = json.loads(line)
            report(id=job["id"], ok=True, duration=speaker.speak(job["text"], job["voice"], job["path"]))
        except Exception as e:  # noqa: BLE001
            report(id=job.get("id"), error=str(e))


if __name__ == "__main__":
    main()
