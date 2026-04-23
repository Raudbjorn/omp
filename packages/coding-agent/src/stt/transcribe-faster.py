"""Transcribe a WAV file using faster-whisper.

Reads WAV directly via Python's wave module (no ffmpeg needed).
Resamples to 16kHz mono float32 and passes to faster-whisper as a numpy array.

Usage: python transcribe-faster.py <audio.wav> <model_name> <language>
Prints transcribed text to stdout.
"""

import sys
import wave
import re

import numpy as np
from faster_whisper import WhisperModel


def load_wav(path: str) -> np.ndarray:
    with wave.open(path, "rb") as wf:
        rate = wf.getframerate()
        channels = wf.getnchannels()
        width = wf.getsampwidth()
        n_frames = wf.getnframes()
        raw = wf.readframes(n_frames)

    if width == 2:
        audio = np.frombuffer(raw, dtype=np.int16).astype(np.float32) / 32768.0
    elif width == 1:
        audio = (np.frombuffer(raw, dtype=np.uint8).astype(np.float32) - 128.0) / 128.0
    elif width == 4:
        audio = np.frombuffer(raw, dtype=np.int32).astype(np.float32) / 2147483648.0
    else:
        raise ValueError(f"Unsupported sample width: {width}")

    if channels > 1:
        audio = audio.reshape(-1, channels).mean(axis=1)

    if rate != 16000:
        target_len = int(len(audio) * 16000 / rate)
        audio = np.interp(
            np.linspace(0, len(audio) - 1, target_len),
            np.arange(len(audio)),
            audio,
        ).astype(np.float32)

    return audio


def main() -> None:
    if len(sys.argv) < 2:
        print("Usage: python transcribe-faster.py <audio.wav> <model_name> <language>", file=sys.stderr)
        sys.exit(1)
    audio_path = sys.argv[1]
    model_name = sys.argv[2] if len(sys.argv) > 2 else "base.en"
    language = sys.argv[3] if len(sys.argv) > 3 else "en"
    if not re.fullmatch(r"[A-Za-z]{2,3}(-[A-Za-z]{2})?", language):
        print(f"Invalid language code: {language}", file=sys.stderr)
        sys.exit(1)

    audio = load_wav(audio_path)
    device, compute_type = _resolve_device_and_compute_type()
    model = WhisperModel(model_name, device=device, compute_type=compute_type)
    segments, _info = model.transcribe(audio, language=language, beam_size=5)
    print(" ".join(segment.text.strip() for segment in segments))


def _resolve_device_and_compute_type() -> tuple[str, str]:
    """Pick the best available device/compute type.

    Honours PI_STT_DEVICE / PI_STT_COMPUTE_TYPE overrides. Otherwise probes for
    CUDA via the ctranslate2 runtime and falls back to cpu/int8.
    """
    import os

    env_device = os.environ.get("PI_STT_DEVICE")
    env_compute = os.environ.get("PI_STT_COMPUTE_TYPE")
    if env_device:
        return env_device, env_compute or ("float16" if env_device == "cuda" else "int8")
    try:
        import ctranslate2
        if ctranslate2.get_cuda_device_count() > 0:
            return "cuda", env_compute or "float16"
    except Exception:
        pass
    return "cpu", env_compute or "int8"


if __name__ == "__main__":
    main()
