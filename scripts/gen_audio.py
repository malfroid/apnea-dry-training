# /// script
# requires-python = ">=3.12"
# dependencies = ["mlx-audio[tts]", "elevenlabs>=1.0", "python-dotenv"]
# ///

"""
Generate the voice clips used by the app.

Two backends:

  AUDIO_PROVIDER=local       (default) — on-device Kokoro TTS via mlx-audio.
  AUDIO_PROVIDER=elevenlabs              ElevenLabs cloud TTS.

ElevenLabs requires ELEVEN_LABS_API_KEY in the environment or the
project's .env file. Voices are looked up by name in your ElevenLabs
voice library, so add Brittney and Jonathan Livingston there first.

Existing .opus + .mp3 outputs are skipped, so re-running is safe and
won't burn ElevenLabs credits unless you delete the target files.
"""

import os
import subprocess
import sys
from pathlib import Path

AUDIO_DIR = Path(__file__).parent.parent / "audio"
AUDIO_DIR.mkdir(exist_ok=True)
PROJECT_ROOT = Path(__file__).parent.parent

PROVIDER = os.environ.get("AUDIO_PROVIDER", "local").lower()
if PROVIDER not in ("local", "elevenlabs"):
    sys.exit(f"AUDIO_PROVIDER must be 'local' or 'elevenlabs' (got {PROVIDER!r})")

# ── Local (Kokoro) ────────────────────────────────────────────────
KOKORO_MODEL = "mlx-community/Kokoro-82M-bf16"
KOKORO_SPEED = 0.9
KOKORO_VOICES = {
    "female": "af_heart",
    "male": "am_michael",
}

# ── ElevenLabs ────────────────────────────────────────────────────
ELEVENLABS_MODEL = os.environ.get("ELEVENLABS_MODEL", "eleven_multilingual_v2")
ELEVENLABS_OUTPUT_FORMAT = os.environ.get(
    "ELEVENLABS_OUTPUT_FORMAT", "mp3_44100_128"
)
ELEVENLABS_SPEED = float(os.environ.get("ELEVENLABS_SPEED", "0.9"))
ELEVENLABS_STABILITY = float(os.environ.get("ELEVENLABS_STABILITY", "0.75"))
ELEVENLABS_SIMILARITY = float(os.environ.get("ELEVENLABS_SIMILARITY", "0.55"))
ELEVENLABS_VOICES = {
    "female": os.environ.get("ELEVENLABS_VOICE_FEMALE", "Lily"),
    "male": os.environ.get("ELEVENLABS_VOICE_MALE", "George"),
}

VOICES = ELEVENLABS_VOICES if PROVIDER == "elevenlabs" else KOKORO_VOICES

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


# ── ElevenLabs client (lazy) ──────────────────────────────────────
_eleven_client = None
_voice_id_cache: dict[str, str] = {}


def _get_eleven_client():
    global _eleven_client
    if _eleven_client is not None:
        return _eleven_client
    from dotenv import load_dotenv
    from elevenlabs.client import ElevenLabs

    load_dotenv(PROJECT_ROOT / ".env")
    api_key = os.environ.get("ELEVEN_LABS_API_KEY")
    if not api_key:
        sys.exit("ELEVEN_LABS_API_KEY not set (check .env or environment).")
    _eleven_client = ElevenLabs(api_key=api_key)
    return _eleven_client


def _looks_like_voice_id(s: str) -> bool:
    """ElevenLabs voice IDs are 20-character base62 strings (no spaces)."""
    return len(s) == 20 and s.isalnum()


def _resolve_eleven_voice_id(name_or_id: str) -> str:
    if name_or_id in _voice_id_cache:
        return _voice_id_cache[name_or_id]
    if _looks_like_voice_id(name_or_id):
        _voice_id_cache[name_or_id] = name_or_id
        return name_or_id
    client = _get_eleven_client()
    try:
        result = client.voices.search(search=name_or_id)
        candidates = list(result.voices)
    except Exception as e:
        sys.exit(
            f"Could not look up voice {name_or_id!r}: {e}\n"
            "Either grant the API key the 'voices_read' permission in the "
            "ElevenLabs dashboard, or pass the 20-char voice ID directly via "
            "ELEVENLABS_VOICE_FEMALE / ELEVENLABS_VOICE_MALE."
        )

    exact = next(
        (v for v in candidates if v.name.lower() == name_or_id.lower()), None
    )
    chosen = exact or (candidates[0] if candidates else None)
    if chosen is None:
        sys.exit(
            f"No ElevenLabs voice matching {name_or_id!r}. "
            "Add it to your voice library in the ElevenLabs dashboard first."
        )
    if chosen.name.lower() != name_or_id.lower():
        print(f"  ⚠ no exact match for {name_or_id!r}; using {chosen.name!r}")
    _voice_id_cache[name_or_id] = chosen.voice_id
    return chosen.voice_id


def _synth_elevenlabs(voice_name: str, text: str, out_wav: Path) -> None:
    from elevenlabs.types import VoiceSettings
    client = _get_eleven_client()
    voice_id = _resolve_eleven_voice_id(voice_name)
    chunks = client.text_to_speech.convert(
        text=text,
        voice_id=voice_id,
        model_id=ELEVENLABS_MODEL,
        output_format=ELEVENLABS_OUTPUT_FORMAT,
        voice_settings=VoiceSettings(
            stability=ELEVENLABS_STABILITY,
            similarity_boost=ELEVENLABS_SIMILARITY,
            speed=ELEVENLABS_SPEED,
        ),
    )
    audio_bytes = b"".join(chunks)
    tmp = out_wav.with_suffix(".tts.tmp")
    tmp.write_bytes(audio_bytes)
    # Decode whatever ElevenLabs returned into a mono 44.1kHz WAV so the
    # downstream ffmpeg pipeline behaves identically to the local backend.
    subprocess.run(
        ["ffmpeg", "-y", "-i", str(tmp), "-ac", "1", "-ar", "44100",
         str(out_wav)],
        check=True,
        capture_output=True,
    )
    tmp.unlink()


def _synth_local(voice_id: str, key: str, text: str, voice_dir: Path) -> None:
    from mlx_audio.tts.generate import generate_audio
    generate_audio(
        text=text,
        model=KOKORO_MODEL,
        voice=voice_id,
        speed=KOKORO_SPEED,
        output_path=str(voice_dir),
        file_prefix=key,
        audio_format="wav",
        join_audio=True,
        verbose=False,
    )


def generate_wav(voice_dir: Path, voice_id: str, key: str, text: str) -> Path:
    wav = voice_dir / f"{key}.wav"
    opus = voice_dir / f"{key}.opus"
    mp3 = voice_dir / f"{key}.mp3"
    if opus.exists() and mp3.exists():
        return wav
    if wav.exists():
        print(f"  skip (exists): {wav.relative_to(AUDIO_DIR)}")
        return wav
    print(f"  generating: {voice_id}/{key} → {text!r}")
    if PROVIDER == "elevenlabs":
        _synth_elevenlabs(voice_id, text, wav)
    else:
        _synth_local(voice_id, key, text, voice_dir)
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
    out_opus = voice_dir / f"{key}.opus"
    out_mp3 = voice_dir / f"{key}.mp3"
    # Skip the (expensive) per-digit synth when the final encoded clips
    # already exist — important for ElevenLabs runs.
    if out_opus.exists() and out_mp3.exists():
        return out_wav
    if out_wav.exists():
        return out_wav

    unique_numbers = sorted(set(numbers))
    raw_parts: dict[int, Path] = {}
    for n in unique_numbers:
        raw = voice_dir / f"_num_{n}.wav"
        if not raw.exists():
            print(f"  generating part: {voice_id}/{n}")
            if PROVIDER == "elevenlabs":
                _synth_elevenlabs(voice_id, f"{n}.", raw)
            else:
                _synth_local(voice_id, f"_num_{n}", f"{n}.", voice_dir)
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


def _estimate_credits() -> int:
    """Worst-case ElevenLabs character count (1 char ≈ 1 credit on standard models)."""
    chars = sum(len(t) for t in CLIPS.values())
    chars += sum(len(f"{n}.") for nums in COUNT_CLIPS.values() for n in set(nums))
    return chars * len(VOICES)


def _which_clips_need_synth() -> int:
    """Count clips that don't yet have both .opus and .mp3 on disk."""
    n = 0
    for voice_label in VOICES:
        voice_dir = AUDIO_DIR / voice_label
        for key in CLIPS:
            if not (
                (voice_dir / f"{key}.opus").exists()
                and (voice_dir / f"{key}.mp3").exists()
            ):
                n += 1
        for key in COUNT_CLIPS:
            if not (
                (voice_dir / f"{key}.opus").exists()
                and (voice_dir / f"{key}.mp3").exists()
            ):
                n += 1
    return n


def main() -> None:
    if PROVIDER == "elevenlabs":
        pending = _which_clips_need_synth()
        worst_case = _estimate_credits()
        print(
            f"Provider: ElevenLabs · model={ELEVENLABS_MODEL} · "
            f"format={ELEVENLABS_OUTPUT_FORMAT}"
        )
        print(f"Voices: {list(VOICES.values())}")
        print(
            f"Clips needing synth: {pending}. "
            f"Worst-case ≈ {worst_case} credits if all were missing.\n"
        )
        if pending > 0 and sys.stdin.isatty():
            ans = input("Proceed with ElevenLabs synthesis? [y/N] ").strip().lower()
            if ans != "y":
                sys.exit("Aborted.")
    else:
        print(f"Provider: local Kokoro at {KOKORO_SPEED}x speed.\n")

    per_voice = len(CLIPS) + len(COUNT_CLIPS)
    total = per_voice * len(VOICES)
    print(f"Generating up to {total} clips ({per_voice} × {len(VOICES)} voices)…\n")

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
