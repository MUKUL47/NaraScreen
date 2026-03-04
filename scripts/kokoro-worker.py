#!/usr/bin/env python3
"""
Kokoro TTS Worker — persistent subprocess that reads JSON jobs from stdin.

Protocol:
  - Parent sends one JSON object per line to stdin:
    {"text": "...", "outputPath": "/path/to/output.wav", "voice": "af_heart", "speed": 1.0, "lang": "en"}
  - Worker responds with one JSON object per line to stdout:
    {"status": "ok", "outputPath": "/path/to/output.wav", "duration": 5.2}
    or
    {"status": "error", "outputPath": "/path/to/output.wav", "error": "..."}
  - Send {"command": "quit"} to exit gracefully.

Usage:
  python kokoro-worker.py [--python-path /path/to/kokoro/venv/bin/python]

The worker loads the Kokoro model ONCE, then processes jobs as they arrive.
"""

import sys
import json
import os
import numpy as np

# Redirect kokoro's loguru output to stderr so it doesn't pollute our JSON protocol
import logging
logging.basicConfig(stream=sys.stderr, level=logging.INFO)

def log(msg):
    print(f"[kokoro-worker] {msg}", file=sys.stderr, flush=True)

def main():
    log("Loading Kokoro model...")

    try:
        from kokoro import KPipeline
        import soundfile as sf
    except ImportError as e:
        log(f"Import error: {e}")
        log("Make sure to run this with the Python that has kokoro installed")
        sys.exit(1)

    # Pre-load pipelines for supported languages
    # 'a' = American English, 'h' = Hindi
    pipelines = {}

    def get_pipeline(lang: str) -> KPipeline:
        lang_code = 'a' if lang in ('en', 'en-us') else 'h' if lang in ('hi',) else 'a'
        if lang_code not in pipelines:
            log(f"Initializing pipeline for lang_code='{lang_code}'...")
            pipelines[lang_code] = KPipeline(lang_code=lang_code, repo_id='hexgrad/Kokoro-82M')
            log(f"Pipeline for '{lang_code}' ready.")
        return pipelines[lang_code]

    log("Ready. Waiting for jobs on stdin...")
    # Signal readiness
    print(json.dumps({"status": "ready"}), flush=True)

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue

        try:
            job = json.loads(line)
        except json.JSONDecodeError as e:
            print(json.dumps({"status": "error", "error": f"Invalid JSON: {e}"}), flush=True)
            continue

        # Quit command
        if job.get("command") == "quit":
            log("Quit command received. Exiting.")
            print(json.dumps({"status": "quit"}), flush=True)
            break

        text = job.get("text", "")
        output_path = job.get("outputPath", "")
        voice = job.get("voice", "af_heart")
        speed = job.get("speed", 1.0)
        lang = job.get("lang", "en")

        if not text or not output_path:
            print(json.dumps({"status": "error", "outputPath": output_path, "error": "Missing text or outputPath"}), flush=True)
            continue

        try:
            pipeline = get_pipeline(lang)

            # Generate audio chunks
            audio_chunks = []
            for result in pipeline(text, voice=voice, speed=speed):
                if result.audio is not None:
                    audio_chunks.append(result.audio.numpy())

            if not audio_chunks:
                print(json.dumps({"status": "error", "outputPath": output_path, "error": "No audio generated"}), flush=True)
                continue

            # Concatenate all chunks
            full_audio = np.concatenate(audio_chunks)

            # Ensure output directory exists
            os.makedirs(os.path.dirname(output_path), exist_ok=True)

            # Save as WAV (Kokoro outputs at 24000 Hz)
            sf.write(output_path, full_audio, 24000)

            duration = len(full_audio) / 24000.0
            log(f"Generated: {os.path.basename(output_path)} ({duration:.1f}s)")

            print(json.dumps({
                "status": "ok",
                "outputPath": output_path,
                "duration": round(duration, 3)
            }), flush=True)

        except Exception as e:
            log(f"Error processing {output_path}: {e}")
            print(json.dumps({
                "status": "error",
                "outputPath": output_path,
                "error": str(e)
            }), flush=True)

    log("Worker exiting.")

if __name__ == "__main__":
    main()
