#!/usr/bin/env python3
"""
transcribe.py — Transcripta Python bridge
==========================================
Standalone script that wraps faster-whisper (and optionally whisperx + pyannote
for diarization).  All output is streamed as JSON lines to stdout so the
Electron main process can parse events incrementally.

Output event shapes
-------------------
  {"type": "progress", "percent": <0-100>, "step": "<label>"}
  {"type": "segment", "speaker": "<SPEAKER_XX|unknown>", "start": <float>, "end": <float>, "text": "<str>"}
  {"type": "complete", "segments_count": <int>, "elapsed_seconds": <float>}
  {"type": "error", "message": "<str>", "code": "<ERROR_CODE>"}

Error codes map to TranscriptionErrorCode in the TypeScript port:
  PYTHON_NOT_FOUND · FASTER_WHISPER_NOT_INSTALLED · CUDA_NOT_AVAILABLE
  FILE_NOT_FOUND · FILE_TOO_LARGE · PROCESS_CRASHED · UNKNOWN
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
import traceback
from pathlib import Path


# ─── JSON-line helpers ────────────────────────────────────────────────────────

def emit(obj: dict) -> None:
    """Write a single JSON-line event to stdout and flush immediately."""
    print(json.dumps(obj, ensure_ascii=False), flush=True)


def progress(percent: int, step: str) -> None:
    emit({"type": "progress", "percent": percent, "step": step})


def segment(speaker: str, start: float, end: float, text: str) -> None:
    emit({"type": "segment", "speaker": speaker, "start": start, "end": end, "text": text.strip()})


def complete(segments_count: int, elapsed_seconds: float) -> None:
    emit({"type": "complete", "segments_count": segments_count, "elapsed_seconds": elapsed_seconds})


def error(message: str, code: str = "UNKNOWN") -> None:
    emit({"type": "error", "message": message, "code": code})


# ─── Argument parsing ─────────────────────────────────────────────────────────

def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Transcribe audio with faster-whisper (+ optional diarization)."
    )
    parser.add_argument("audio_path", help="Absolute path to the audio/video file")
    parser.add_argument(
        "--model", default="large-v3",
        help="faster-whisper model size (default: large-v3)"
    )
    parser.add_argument(
        "--device", default="cuda",
        choices=["cuda", "cpu"],
        help="Compute device (default: cuda)"
    )
    parser.add_argument(
        "--compute", default="float16",
        choices=["float16", "int8", "float32"],
        help="Compute type (default: float16)"
    )
    parser.add_argument(
        "--diarize", action="store_true",
        help="Run speaker diarization via whisperx + pyannote"
    )
    parser.add_argument(
        "--hf-token", default=None,
        help="HuggingFace token required for pyannote diarization"
    )
    return parser.parse_args()


# ─── Availability check ───────────────────────────────────────────────────────

def check_faster_whisper() -> None:
    """Raise ImportError if faster-whisper is not installed."""
    try:
        import faster_whisper  # noqa: F401
    except ImportError:
        raise ImportError("faster-whisper is not installed")


def check_cuda_available(device: str) -> None:
    """Warn (stderr) if CUDA is requested but not visible to PyTorch/ctranslate2."""
    if device != "cuda":
        return
    try:
        import ctranslate2
        if not ctranslate2.get_cuda_device_count():
            # Emit a warning to stderr; fall through and let faster-whisper
            # raise a proper error if it truly can't use CUDA.
            print(
                json.dumps({"type": "warning", "message": "No CUDA devices detected by ctranslate2"}),
                file=sys.stderr,
                flush=True,
            )
    except Exception:
        pass  # ctranslate2 not importable or another error — let faster-whisper handle it


# ─── Diarization helper ───────────────────────────────────────────────────────

def run_diarization(audio_path: str, hf_token: str | None, num_speakers_hint: int | None = None) -> list[dict]:
    """
    Runs whisperx alignment + pyannote diarization and returns a list of
    diarized segments: {"speaker": str, "start": float, "end": float, "text": str}.

    Returns an empty list and prints a warning if diarization fails.
    """
    try:
        import whisperx  # type: ignore
        import torch

        device = "cuda" if torch.cuda.is_available() else "cpu"
        audio = whisperx.load_audio(audio_path)

        progress(70, "aligning")
        # We receive the raw whisper result from the caller; re-load here for
        # the alignment model.  whisperx needs a pre-loaded model reference.
        model_a, metadata = whisperx.load_align_model(language_code="auto", device=device)

        # NOTE: `result` is passed in via the closure variable set by the caller.
        aligned = whisperx.align(
            _diarize_state["whisper_result"]["segments"],
            model_a,
            metadata,
            audio,
            device,
            return_char_alignments=False,
        )

        progress(80, "diarizing")
        diarize_model = whisperx.DiarizationPipeline(
            use_auth_token=hf_token,
            device=device,
        )
        diarize_segments = diarize_model(audio)
        result_with_speakers = whisperx.assign_word_speakers(diarize_segments, aligned)

        out = []
        for seg in result_with_speakers.get("segments", []):
            out.append({
                "speaker": seg.get("speaker", "SPEAKER_00"),
                "start": float(seg.get("start", 0)),
                "end": float(seg.get("end", 0)),
                "text": seg.get("text", "").strip(),
            })
        return out

    except ImportError:
        print(
            json.dumps({"type": "warning", "message": "whisperx not installed; diarization skipped"}),
            file=sys.stderr,
            flush=True,
        )
        return []
    except Exception as exc:
        print(
            json.dumps({"type": "warning", "message": f"Diarization failed: {exc}; proceeding without speakers"}),
            file=sys.stderr,
            flush=True,
        )
        return []


# Module-level mutable state shared between transcribe() and run_diarization().
_diarize_state: dict = {}


# ─── Core transcription ───────────────────────────────────────────────────────

def transcribe(args: argparse.Namespace) -> None:
    t_start = time.monotonic()

    # ── 1. Validate input file ────────────────────────────────────────────────
    audio_path = Path(args.audio_path)
    if not audio_path.exists():
        error(f"File not found: {audio_path}", "FILE_NOT_FOUND")
        sys.exit(1)

    # Rough guard: > 10 GB is almost certainly a mistake
    file_size_gb = audio_path.stat().st_size / (1024 ** 3)
    if file_size_gb > 10:
        error(f"File too large ({file_size_gb:.1f} GB)", "FILE_TOO_LARGE")
        sys.exit(1)

    # ── 2. Import guard ───────────────────────────────────────────────────────
    try:
        check_faster_whisper()
    except ImportError:
        error("faster-whisper is not installed", "FASTER_WHISPER_NOT_INSTALLED")
        sys.exit(1)

    check_cuda_available(args.device)

    # ── 3. Load model ─────────────────────────────────────────────────────────
    progress(5, "loading model")
    try:
        from faster_whisper import WhisperModel  # type: ignore

        model = WhisperModel(
            args.model,
            device=args.device,
            compute_type=args.compute,
        )
    except ValueError as exc:
        msg = str(exc)
        if "cuda" in msg.lower() or "gpu" in msg.lower():
            error(f"CUDA not available: {msg}", "CUDA_NOT_AVAILABLE")
        else:
            error(f"Failed to load model: {msg}", "UNKNOWN")
        sys.exit(1)
    except Exception as exc:
        msg = str(exc)
        if "out of memory" in msg.lower():
            error("CUDA out of memory — try a smaller model or int8 compute type", "CUDA_NOT_AVAILABLE")
        else:
            error(f"Failed to load model: {msg}", "UNKNOWN")
        sys.exit(1)

    # ── 4. Transcribe ─────────────────────────────────────────────────────────
    progress(10, "transcribing")
    try:
        segments_iter, info = model.transcribe(
            str(audio_path),
            beam_size=5,
            vad_filter=True,
            vad_parameters={"min_silence_duration_ms": 500},
        )
    except Exception as exc:
        msg = str(exc)
        if "out of memory" in msg.lower():
            error("CUDA out of memory during transcription", "CUDA_NOT_AVAILABLE")
        else:
            error(f"Transcription failed: {msg}", "UNKNOWN")
        sys.exit(1)

    # Collect raw segments while streaming progress.
    # faster-whisper yields segments lazily; we track progress by audio position.
    raw_segments: list[dict] = []
    audio_duration = getattr(info, "duration", None) or 1.0  # fallback to avoid /0

    try:
        for seg in segments_iter:
            raw_segments.append({
                "start": float(seg.start),
                "end": float(seg.end),
                "text": seg.text.strip(),
            })
            # Map audio position → 10-60% progress band
            pos_frac = min(seg.end / audio_duration, 1.0)
            pct = int(10 + pos_frac * 50)  # 10 → 60
            progress(pct, "transcribing")
    except Exception as exc:
        msg = str(exc)
        if "out of memory" in msg.lower():
            error("CUDA out of memory while reading segments", "CUDA_NOT_AVAILABLE")
        else:
            error(f"Error reading segments: {msg}", "UNKNOWN")
        sys.exit(1)

    progress(60, "processing")

    # ── 5. Diarization (optional) ─────────────────────────────────────────────
    final_segments: list[dict]

    if args.diarize:
        _diarize_state["whisper_result"] = {"segments": raw_segments}
        diarized = run_diarization(str(audio_path), args.hf_token)

        if diarized:
            final_segments = diarized
        else:
            # Fallback: use raw segments without speaker labels
            final_segments = [
                {**s, "speaker": "unknown"}
                for s in raw_segments
            ]
    else:
        final_segments = [
            {**s, "speaker": "unknown"}
            for s in raw_segments
        ]

    # ── 6. Emit segments ──────────────────────────────────────────────────────
    progress(90, "streaming results")
    for seg in final_segments:
        segment(
            speaker=seg.get("speaker", "unknown"),
            start=seg["start"],
            end=seg["end"],
            text=seg["text"],
        )

    # ── 7. Done ───────────────────────────────────────────────────────────────
    elapsed = time.monotonic() - t_start
    complete(segments_count=len(final_segments), elapsed_seconds=round(elapsed, 2))


# ─── Entry point ──────────────────────────────────────────────────────────────

if __name__ == "__main__":
    try:
        args = parse_args()
        transcribe(args)
    except KeyboardInterrupt:
        error("Process cancelled", "CANCELLED")
        sys.exit(130)
    except SystemExit:
        raise
    except Exception as exc:
        tb = traceback.format_exc()
        print(tb, file=sys.stderr, flush=True)
        error(f"Unexpected error: {exc}", "PROCESS_CRASHED")
        sys.exit(1)
