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
    "breathe": "Breathe.",
    "hold": "Hold.",
    "after_contraction": "Keep holding.",
    "one_breath": "Take one single breath. Tap when ready.",
    "complete": "Session complete. Well done!",
    "tap_contraction": "Tap when you feel the first contraction.",
    "n10": "10.",
    "relax": "Take this time to relax. Breathe slowly and deeply.",
}

# Built by concatenating individually-spoken numbers, each padded to exactly
# SECONDS_PER_NUMBER, so the audio stays in sync with the visual 1-second tick.
COUNT_CLIPS = {
    "count_321": [3, 2, 1],
    "count_54321": [5, 4, 3, 2, 1],
}
SECONDS_PER_NUMBER = 1.0


def generate_wav(voice_dir: Path, voice_id: str, key: str, text: str) -> Path:
    wav = voice_dir / f"{key}.wav"
    opus = voice_dir / f"{key}.opus"
    mp3 = voice_dir / f"{key}.mp3"
    if opus.exists() and mp3.exists():
        # Already encoded; skip TTS regeneration
        return wav
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
# Count clips are pre-paced with deliberate trailing silence, so only trim
# the leading silence on encode.
SILENCE_TRIM_LEAD_ONLY = (
    "silenceremove=start_periods=1:start_silence=0.02:start_threshold=-40dB"
)


def build_count_wav(
    voice_dir: Path, voice_id: str, key: str, numbers: list[int]
) -> Path:
    out_wav = voice_dir / f"{key}.wav"
    if out_wav.exists():
        return out_wav

    unique_numbers = sorted(set(numbers))
    raw_parts: dict[int, Path] = {}
    for n in unique_numbers:
        raw = voice_dir / f"_num_{n}.wav"
        if not raw.exists():
            print(f"  generating part: {voice_id}/{n}")
            generate_audio(
                text=f"{n}.",
                model=MODEL,
                voice=voice_id,
                speed=SPEED,
                output_path=str(voice_dir),
                file_prefix=f"_num_{n}",
                audio_format="wav",
                join_audio=True,
                verbose=False,
            )
        raw_parts[n] = raw

    fixed_parts: dict[int, Path] = {}
    for n in unique_numbers:
        fixed = voice_dir / f"_num_{n}_fixed.wav"
        if not fixed.exists():
            subprocess.run(
                [
                    "ffmpeg", "-y", "-i", str(raw_parts[n]),
                    "-af",
                    f"{SILENCE_TRIM},apad=whole_dur={SECONDS_PER_NUMBER}",
                    str(fixed),
                ],
                check=True,
                capture_output=True,
            )
        fixed_parts[n] = fixed

    inputs_args: list[str] = []
    for n in numbers:
        inputs_args.extend(["-i", str(fixed_parts[n])])
    nparts = len(numbers)
    filter_str = (
        "".join(f"[{i}:a]" for i in range(nparts))
        + f"concat=n={nparts}:v=0:a=1[out]"
    )
    print(f"  concatenating: {voice_id}/{key}")
    subprocess.run(
        ["ffmpeg", "-y", *inputs_args, "-filter_complex", filter_str,
         "-map", "[out]", str(out_wav)],
        check=True,
        capture_output=True,
    )
    return out_wav


def compress(voice_dir: Path, key: str, wav: Path) -> None:
    opus = voice_dir / f"{key}.opus"
    mp3 = voice_dir / f"{key}.mp3"

    af = SILENCE_TRIM_LEAD_ONLY if key.startswith("count_") else SILENCE_TRIM

    if not opus.exists():
        subprocess.run(
            [
                "ffmpeg", "-y", "-i", str(wav),
                "-af", af,
                "-c:a", "libopus", "-b:a", "24k",
                "-application", "voip", "-vbr", "on",
                str(opus),
            ],
            check=True,
            capture_output=True,
        )

    if not mp3.exists():
        subprocess.run(
            [
                "ffmpeg", "-y", "-i", str(wav),
                "-af", af,
                "-c:a", "libmp3lame", "-b:a", "48k",
                str(mp3),
            ],
            check=True,
            capture_output=True,
        )

    if wav.exists():
        wav.unlink()


def main() -> None:
    per_voice = len(CLIPS) + len(COUNT_CLIPS)
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
        for key, numbers in COUNT_CLIPS.items():
            i += 1
            print(f"[{i}/{total}]", end=" ")
            wavs[key] = build_count_wav(voice_dir, voice_id, key, numbers)

        print(f"\nCompressing {voice_label} to Opus + MP3…")
        for key, wav in wavs.items():
            if wav.exists():
                compress(voice_dir, key, wav)
                print(f"  compressed: {voice_label}/{key}")

        # Clean up intermediate per-number files used to build count clips
        for tmp in voice_dir.glob("_num_*"):
            tmp.unlink()

    opus_files = list(AUDIO_DIR.rglob("*.opus"))
    mp3_files = list(AUDIO_DIR.rglob("*.mp3"))
    total_bytes = sum(f.stat().st_size for f in opus_files + mp3_files)
    print(
        f"\nDone. {len(opus_files)} Opus + {len(mp3_files)} MP3 files, "
        f"{total_bytes / 1024:.0f} KB total."
    )


if __name__ == "__main__":
    main()
