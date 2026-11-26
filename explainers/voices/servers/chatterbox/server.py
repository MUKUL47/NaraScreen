"""OpenAI-compatible TTS server for Chatterbox Multilingual V3 (Resemble AI, MIT).

POST /v1/audio/speech  {"model": "chatterbox", "input": "...", "voice": "hi_f1", "response_format": "mp3",
                        "language": "hi", "exaggeration": 0.5, "cfg_weight": 0.5, "temperature": 0.8, "seed": 0}
  voice:     a file stem in $NARASCREEN_TTS_HOME/voices (wav/flac/mp3), or "default" (built-in voice).
             Unknown names (e.g. OpenAI "alloy") fall back to the language's default voice.
  language:  any Chatterbox code (en, hi, ...); if absent: Devanagari text -> hi, otherwise en.
             Marathi (Devanagari) is accepted as "mr" and spoken with the Hindi model (cross-lingual, Hindi accent).
  response_format: mp3 | wav | flac | opus | pcm (s16le, 24 kHz mono).  speed is accepted and ignored.
GET /v1/models, GET /v1/voices, GET /health

Started by scripts/voice-engine.sh up chatterbox (via chatterbox/serve.sh), inside the GPU container, on port 8890.
"""
import io
import os
import re
import threading
import time
from pathlib import Path

import numpy as np
import soundfile as sf
import torch
import uvicorn
from fastapi import FastAPI, HTTPException
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel

from chatterbox.mtl_tts import SUPPORTED_LANGUAGES, ChatterboxMultilingualTTS

VOICES = Path(os.environ.get("NARASCREEN_TTS_VOICES") or Path(os.environ["NARASCREEN_TTS_HOME"]) / "voices")
DEFAULT_VOICE = {"hi": "hi_f1", "mr": "hi_f1", "en": "en_f1"}
MAX_CHARS = 280          # per generation chunk (the model caps at ~40 s per call)
GAP_S = 0.15

app = FastAPI(title="chatterbox-openai")
lock = threading.Lock()
state = {"model": None, "voice": None}


class SpeechReq(BaseModel):
    input: str
    model: str | None = "chatterbox"
    voice: str | None = None
    response_format: str | None = "mp3"
    language: str | None = None
    speed: float | None = 1.0
    exaggeration: float = 0.5
    cfg_weight: float = 0.5
    temperature: float = 0.8
    seed: int | None = None


def detect_lang(text):
    return "hi" if re.search(r"[ऀ-ॿ]", text) else "en"


def split_text(text):
    parts = re.split(r"(?<=[.!?।॥])\s+", text.strip())
    chunks, cur = [], ""
    for p in parts:
        if cur and len(cur) + 1 + len(p) > MAX_CHARS:
            chunks.append(cur)
            cur = p
        else:
            cur = f"{cur} {p}".strip()
    if cur:
        chunks.append(cur)
    out = []
    for c in chunks:     # hard-split anything still too long at commas/spaces
        while len(c) > MAX_CHARS:
            cut = max(c.rfind(",", 0, MAX_CHARS), c.rfind(" ", 0, MAX_CHARS))
            cut = cut if cut > 0 else MAX_CHARS
            out.append(c[:cut + 1].strip())
            c = c[cut + 1:].strip()
        if c:
            out.append(c)
    return out


def voice_path(name, lang):
    if name == "default":
        return None
    for cand in (name, DEFAULT_VOICE.get(lang, "en_f1")):
        if cand:
            for ext in (".wav", ".flac", ".mp3"):
                p = VOICES / f"{cand}{ext}"
                if p.is_file():
                    return p
    return None


def encode(wav, sr, fmt):
    fmt = (fmt or "mp3").lower()
    if fmt == "pcm":
        return (np.clip(wav, -1, 1) * 32767).astype("<i2").tobytes(), "audio/pcm"
    buf = io.BytesIO()
    if fmt == "mp3":
        sf.write(buf, wav, sr, format="MP3")
        return buf.getvalue(), "audio/mpeg"
    if fmt == "wav":
        sf.write(buf, wav, sr, format="WAV", subtype="PCM_16")
        return buf.getvalue(), "audio/wav"
    if fmt == "flac":
        sf.write(buf, wav, sr, format="FLAC")
        return buf.getvalue(), "audio/flac"
    if fmt == "opus":
        sf.write(buf, wav, 48000 if sr not in (8000, 12000, 16000, 24000, 48000) else sr, format="OGG", subtype="OPUS")
        return buf.getvalue(), "audio/ogg"
    raise HTTPException(400, f"unsupported response_format {fmt!r}")


@app.on_event("startup")
def load():
    t0 = time.perf_counter()
    m = ChatterboxMultilingualTTS.from_pretrained(device="cuda", t3_model="v3")
    state["builtin"] = m.conds
    m.generate("Warm up.", language_id="en")
    state["model"] = m
    print(f"chatterbox v3 ready on {torch.cuda.get_device_name(0)} in {time.perf_counter() - t0:.1f}s", flush=True)


@app.get("/health")
def health():
    ok = state["model"] is not None
    return JSONResponse({"status": "ok" if ok else "loading"}, status_code=200 if ok else 503)


@app.get("/v1/models")
def models():
    return {"object": "list", "data": [{"id": "chatterbox", "object": "model", "owned_by": "resemble-ai"}]}


@app.get("/v1/voices")
def voices():
    names = sorted({p.stem for p in VOICES.iterdir() if p.suffix in (".wav", ".flac", ".mp3")})
    return {"voices": ["default"] + names, "languages": sorted(list(SUPPORTED_LANGUAGES) + ["mr"])}


@app.post("/v1/audio/speech")
def speech(req: SpeechReq):
    m = state["model"]
    if m is None:
        raise HTTPException(503, "model loading")
    if not req.input.strip():
        raise HTTPException(400, "input is empty")
    lang = (req.language or detect_lang(req.input)).lower()
    model_lang = "hi" if lang == "mr" else lang
    if model_lang not in SUPPORTED_LANGUAGES:
        raise HTTPException(400, f"unsupported language {lang!r}")
    vp = voice_path(req.voice or "", lang)
    pieces = []
    with lock:
        if req.seed is not None:
            torch.manual_seed(req.seed)
        if vp is None:
            m.conds = state["builtin"]
            state["voice"] = None
        elif state["voice"] != (str(vp), req.exaggeration):
            m.prepare_conditionals(str(vp), exaggeration=req.exaggeration)
            state["voice"] = (str(vp), req.exaggeration)
        for chunk in split_text(req.input):
            w = m.generate(chunk, language_id=model_lang, exaggeration=req.exaggeration, cfg_weight=req.cfg_weight,
                           temperature=req.temperature)
            pieces.append(w.squeeze(0).numpy())
            pieces.append(np.zeros(int(GAP_S * m.sr), np.float32))
    wav = np.concatenate(pieces[:-1]) if pieces else np.zeros(1, np.float32)
    body, ctype = encode(wav, m.sr, req.response_format)
    return Response(body, media_type=ctype, headers={"X-Sample-Rate": str(m.sr), "X-Language": lang})


if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=int(os.environ.get("PORT", "8890")), log_level="info")
