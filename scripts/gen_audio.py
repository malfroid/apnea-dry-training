# /// script
# requires-python = ">=3.12"
# dependencies = ["mlx-audio[tts]"]
# ///

import subprocess
import sys
from pathlib import Path

from mlx_audio.tts.generate import generate_audio

AUDIO_DIR = Path(__file__).parent.parent / "audio"
AUDIO_DIR.mkdir(exist_ok=True)

MODEL = "mlx-community/Kokoro-82M-bf16"
VOICE = "af_heart"
SPEED = 0.9

CLIPS = {
    "ready": "Get ready.",
    "rest": "Rest.",
    "after_contraction": "Keep holding.",
    "one_breath": "Take one single breath. Tap when ready.",
    "complete": "Session complete. Well done!",
    "tap_contraction": "Tap when you feel the first contraction.",
    "n1": "1",
    "n2": "2",
    "n3": "3",
    "n10": "10",
    **{f"hold_{i}": f"Round {i}. Hold." for i in range(1, 21)},
}


def generate_wav(key: str, text: str) -> Path:
    wav = AUDIO_DIR / f"{key}.wav"
    if wav.exists():
        print(f"  skip (exists): {wav.name}")
        return wav
    print(f"  generating: {key!r} → {text!r}")
    generate_audio(
        text=text,
        model=MODEL,
        voice=VOICE,
        speed=SPEED,
        output_path=str(AUDIO_DIR),
        file_prefix=key,
        audio_format="wav",
        join_audio=True,
        verbose=False,
    )
    return wav


def compress(key: str, wav: Path) -> None:
    opus = AUDIO_DIR / f"{key}.opus"
    mp3 = AUDIO_DIR / f"{key}.mp3"

    if not opus.exists():
        subprocess.run(
            [
                "ffmpeg",
                "-y",
                "-i",
                str(wav),
                "-c:a",
                "libopus",
                "-b:a",
                "24k",
                "-application",
                "voip",
                "-vbr",
                "on",
                str(opus),
            ],
            check=True,
            capture_output=True,
        )

    if not mp3.exists():
        subprocess.run(
            [
                "ffmpeg",
                "-y",
                "-i",
                str(wav),
                "-c:a",
                "libmp3lame",
                "-b:a",
                "48k",
                str(mp3),
            ],
            check=True,
            capture_output=True,
        )

    wav.unlink()


def main() -> None:
    total = len(CLIPS)
    print(f"Generating {total} clips with Kokoro ({VOICE}, {SPEED}x speed)…\n")

    wavs: dict[str, Path] = {}
    for i, (key, text) in enumerate(CLIPS.items(), 1):
        print(f"[{i}/{total}]", end=" ")
        wavs[key] = generate_wav(key, text)

    print("\nCompressing to Opus + MP3…")
    for key, wav in wavs.items():
        if wav.exists():
            compress(key, wav)
            print(f"  compressed: {key}")

    opus_files = list(AUDIO_DIR.glob("*.opus"))
    mp3_files = list(AUDIO_DIR.glob("*.mp3"))
    total_bytes = sum(f.stat().st_size for f in opus_files + mp3_files)
    print(
        f"\nDone. {len(opus_files)} Opus + {len(mp3_files)} MP3 files, "
        f"{total_bytes / 1024:.0f} KB total."
    )


if __name__ == "__main__":
    main()
