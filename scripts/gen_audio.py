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
SPEED = 0.9

VOICES = {
    "female": "af_heart",
    "male": "am_michael",
}

CLIPS = {
    "rest": "Rest.",
    "hold": "Hold.",
    "after_contraction": "Keep holding.",
    "one_breath": "Take one single breath. Tap when ready.",
    "complete": "Session complete. Well done!",
    "tap_contraction": "Tap when you feel the first contraction.",
    "n10": "10.",
    "count_321": "3, 2, 1.",
    "count_54321": "5, 4, 3, 2, 1.",
}


def generate_wav(voice_dir: Path, voice_id: str, key: str, text: str) -> Path:
    wav = voice_dir / f"{key}.wav"
    if wav.exists():
        print(f"  skip (exists): {wav.relative_to(AUDIO_DIR)}")
        return wav
    print(f"  generating: {voice_id}/{key} → {text!r}")
    generate_audio(
        text=text,
        model=MODEL,
        voice=voice_id,
        speed=SPEED,
        output_path=str(voice_dir),
        file_prefix=key,
        audio_format="wav",
        join_audio=True,
        verbose=False,
    )
    return wav


SILENCE_TRIM = (
    "silenceremove=start_periods=1:start_silence=0.02:start_threshold=-40dB,"
    "areverse,"
    "silenceremove=start_periods=1:start_silence=0.05:start_threshold=-40dB,"
    "areverse"
)


def compress(voice_dir: Path, key: str, wav: Path) -> None:
    opus = voice_dir / f"{key}.opus"
    mp3 = voice_dir / f"{key}.mp3"

    if not opus.exists():
        subprocess.run(
            [
                "ffmpeg",
                "-y",
                "-i",
                str(wav),
                "-af",
                SILENCE_TRIM,
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
                "-af",
                SILENCE_TRIM,
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
    per_voice = len(CLIPS)
    total = per_voice * len(VOICES)
    print(
        f"Generating {total} clips ({per_voice} × {len(VOICES)} voices) "
        f"at {SPEED}x speed…\n"
    )

    i = 0
    for voice_label, voice_id in VOICES.items():
        voice_dir = AUDIO_DIR / voice_label
        voice_dir.mkdir(exist_ok=True)
        print(f"\n── voice: {voice_label} ({voice_id}) ──")
        wavs: dict[str, Path] = {}
        for key, text in CLIPS.items():
            i += 1
            print(f"[{i}/{total}]", end=" ")
            wavs[key] = generate_wav(voice_dir, voice_id, key, text)

        print(f"\nCompressing {voice_label} to Opus + MP3…")
        for key, wav in wavs.items():
            if wav.exists():
                compress(voice_dir, key, wav)
                print(f"  compressed: {voice_label}/{key}")

    opus_files = list(AUDIO_DIR.rglob("*.opus"))
    mp3_files = list(AUDIO_DIR.rglob("*.mp3"))
    total_bytes = sum(f.stat().st_size for f in opus_files + mp3_files)
    print(
        f"\nDone. {len(opus_files)} Opus + {len(mp3_files)} MP3 files, "
        f"{total_bytes / 1024:.0f} KB total."
    )


if __name__ == "__main__":
    main()
