// Run: node_modules/.bin/tsx --test api/_tests/narration.test.ts
//
// Narration without a real speech engine: a tiny local HTTP server plays
// Kokoro (valid WAV, a 400 "voice not found", a junk 200) and a closed port
// plays "Kokoro is down". Needs ffprobe (clip durations), nothing else.

import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "fs";
import * as http from "http";
import * as os from "os";
import * as path from "path";
import type { AddressInfo } from "net";
import { AgentError } from "../errors.ts";
import {
  checkTts,
  clipFileName,
  resolveNarration,
  resolveTtsTarget,
  resolveVoice,
  synthesizeNarrations,
} from "../narration.ts";
import { setQuiet } from "../output.ts";
import { DEFAULT_KOKORO_ENDPOINT, type DemoScript, type FxEntry } from "../schema.ts";

delete process.env.KOKORO_PYTHON;
setQuiet(true);

/** 0.5 s of a 440 Hz tone, 24 kHz mono 16-bit — what Kokoro returns. */
function wav(seconds = 0.5): Buffer {
  const rate = 24000;
  const n = Math.round(rate * seconds);
  const buf = Buffer.alloc(44 + n * 2);
  buf.write("RIFF", 0, "ascii");
  buf.writeUInt32LE(36 + n * 2, 4);
  buf.write("WAVEfmt ", 8, "ascii");
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20); // PCM
  buf.writeUInt16LE(1, 22); // mono
  buf.writeUInt32LE(rate, 24);
  buf.writeUInt32LE(rate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write("data", 36, "ascii");
  buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) buf.writeInt16LE(Math.round(8000 * Math.sin((2 * Math.PI * 440 * i) / rate)), 44 + i * 2);
  return buf;
}

const requests: { url: string; body: Record<string, unknown> }[] = [];
let server: http.Server;
let base = "";
let deadEndpoint = "";
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "narascreen-narration-"));

before(async () => {
  server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      const url = req.url ?? "";
      if (req.method === "GET" && url === "/ok/v1/models") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ object: "list", data: [{ id: "kokoro" }, { id: "tts-1" }] }));
        return;
      }
      if (req.method !== "POST") return void res.writeHead(404).end();
      requests.push({ url, body: JSON.parse(raw) });
      if (url === "/ok/v1/audio/speech") {
        res.writeHead(200, { "Content-Type": "audio/wav" });
        res.end(wav());
      } else if (url === "/bad-voice/v1/audio/speech") {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ detail: { error: "validation_error", message: "Voice 'zz_nobody' not found. Available voices: af_heart, …" } }));
      } else if (url === "/junk/v1/audio/speech") {
        res.writeHead(200, { "Content-Type": "text/plain" });
        res.end("x".repeat(4000));
      } else {
        res.writeHead(404).end();
      }
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  // A port that was just free: connecting to it is refused.
  const probe = http.createServer();
  await new Promise<void>((r) => probe.listen(0, "127.0.0.1", r));
  deadEndpoint = `http://127.0.0.1:${(probe.address() as AddressInfo).port}/v1/audio/speech`;
  await new Promise<void>((r) => probe.close(() => r()));
});

after(async () => {
  await new Promise<void>((r) => server.close(() => r()));
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

function script(endpoint: string, steps: DemoScript["steps"], extra: Partial<DemoScript> = {}): DemoScript {
  return { version: 1, scope: "t", baseUrl: "http://localhost:1", viewport: { width: 1440, height: 900 }, tts: { kokoroEndpoint: endpoint }, steps, ...extra };
}

const newDir = (name: string) => fs.mkdtempSync(path.join(tmpRoot, `${name}-`));

// ── text / voice / target resolution ─────────────────────────

test("resolveNarration: string, map, forced lang, en fallback, missing", () => {
  const fx = (o: Partial<FxEntry>): FxEntry => ({ fx: "narrate", ...o });
  assert.deepEqual(resolveNarration(fx({ narrate: "Hello" }), "fr"), { lang: "fr", text: "Hello" });
  assert.deepEqual(resolveNarration(fx({ narrate: { en: "Hi", hi: "नमस्ते" } }), "hi"), { lang: "hi", text: "नमस्ते" });
  assert.deepEqual(resolveNarration(fx({ narrate: { en: "Hi" } }), "hi"), { lang: "en", text: "Hi" });
  assert.deepEqual(resolveNarration(fx({ narrate: "नमस्ते", lang: "hi" }), "en"), { lang: "hi", text: "नमस्ते" });
  assert.equal(resolveNarration(fx({ narrate: { hi: "नमस्ते" } }), "es"), null);
  assert.equal(resolveNarration(fx({ narrate: "   " }), "en"), null);
});

test("resolveVoice: fx.voice → tts.voices → legacy voiceEn/voiceHi → catalog default → af_heart", () => {
  const s = (tts: DemoScript["tts"]) => script(DEFAULT_KOKORO_ENDPOINT, [{ id: "a", beat: [{ act: "wait", ms: 1 }] }], { tts });
  const fx: FxEntry = { fx: "narrate", narrate: "x" };
  assert.equal(resolveVoice(s({ voices: { en: "am_adam" } }), { ...fx, voice: "af_sky" }, "en"), "af_sky");
  assert.equal(resolveVoice(s({ voices: { en: "am_adam" }, voiceEn: "af_bella" }), fx, "en"), "am_adam");
  assert.equal(resolveVoice(s({ voiceEn: "af_bella", voiceHi: "hm_omega" }), fx, "hi"), "hm_omega");
  assert.equal(resolveVoice(s({}), fx, "es"), "ef_dora");
  assert.equal(resolveVoice(s({}), fx, "xx"), "af_heart");
});

test("resolveTtsTarget: http by default; KOKORO_PYTHON only when it is an existing absolute path", () => {
  assert.deepEqual(resolveTtsTarget(), { mode: "http", endpoint: DEFAULT_KOKORO_ENDPOINT });
  assert.deepEqual(resolveTtsTarget(script("http://tts.local:9/v1/audio/speech", [])), { mode: "http", endpoint: "http://tts.local:9/v1/audio/speech" });
  try {
    process.env.KOKORO_PYTHON = "python3";
    assert.equal(resolveTtsTarget().mode, "http");
    process.env.KOKORO_PYTHON = process.execPath;
    assert.deepEqual(resolveTtsTarget(), { mode: "python", python: process.execPath });
  } finally {
    delete process.env.KOKORO_PYTHON;
  }
});

test("checkTts: probes <prefix>/v1/models; a closed port is reported, not thrown", async () => {
  const ok = await checkTts({ mode: "http", endpoint: `${base}/ok/v1/audio/speech` });
  assert.equal(ok.ok, true, ok.detail);
  assert.match(ok.detail, /kokoro/);
  const down = await checkTts({ mode: "http", endpoint: deadEndpoint });
  assert.equal(down.ok, false);
  assert.match(down.detail, /not reachable/);
});

// ── synthesis ────────────────────────────────────────────────

const steps: DemoScript["steps"] = [
  { id: "intro", beat: [
    { act: "click", text: "Open" },
    { fx: "narrate", narrate: { en: "Welcome.", hi: "स्वागत है।" } },
    { fx: "zoom" },
    { fx: "zoom", narrate: "Look closer.", voice: "am_adam" },
  ] },
];

test("synthesizeNarrations: one clip per narrate / narrated zoom, content-addressed cache", async () => {
  const dir = newDir("ok");
  const endpoint = `${base}/ok/v1/audio/speech`;
  const before = requests.length;
  const clips = await synthesizeNarrations(script(endpoint, steps), "en", dir, () => {});
  assert.deepEqual([...clips.keys()], ["intro:1", "intro:3"]);
  const a = clips.get("intro:1")!;
  assert.equal(a.text, "Welcome.");
  assert.equal(a.voice, "af_heart");
  assert.equal(a.cached, false);
  assert.ok(Math.abs(a.durationSec - 0.5) < 0.05, `duration ${a.durationSec}`);
  assert.equal(a.audioPath, path.join(dir, clipFileName("en", "af_heart", 1, "Welcome.")));
  assert.match(path.basename(a.audioPath), /^tts_[0-9a-f]{16}\.wav$/);
  assert.equal(clips.get("intro:3")!.voice, "am_adam");
  const sent = requests.slice(before);
  assert.equal(sent.length, 2);
  assert.deepEqual(sent[0].body, { model: "kokoro", input: "Welcome.", voice: "af_heart", speed: 1, response_format: "wav" });

  const again = await synthesizeNarrations(script(endpoint, steps), "en", dir, () => {});
  assert.equal(requests.length, before + 2, "second run hits the cache");
  assert.ok([...again.values()].every((c) => c.cached));

  const hi = await synthesizeNarrations(script(endpoint, steps), "hi", dir, () => {});
  assert.equal(hi.get("intro:1")!.text, "स्वागत है।");
  assert.equal(hi.get("intro:1")!.voice, "hf_alpha");
  assert.equal(hi.get("intro:3")!.lang, "hi", "a plain string is spoken in the produce language");
});

test("HTTP 400 (unknown voice) → TTS_FAILED with where + details", async () => {
  const bad = script(`${base}/bad-voice/v1/audio/speech`, [{ id: "s1", beat: [{ act: "wait", ms: 1 }, { fx: "narrate", narrate: "Hi", voice: "zz_nobody" }] }]);
  await assert.rejects(synthesizeNarrations(bad, "en", newDir("bad"), () => {}), (e: unknown) => {
    assert.ok(e instanceof AgentError);
    assert.equal(e.code, "TTS_FAILED");
    assert.deepEqual(e.where, { step: "s1", entry: 1, path: "steps[0].beat[1]" });
    assert.equal(e.details?.status, 400);
    assert.match(String(e.details?.body), /not found/);
    assert.equal(e.details?.voice, "zz_nobody");
    assert.match(e.hint ?? "", /narascreen voices/);
    return true;
  });
});

test("a 200 that is not audio → TTS_FAILED, nothing cached", async () => {
  const dir = newDir("junk");
  const junk = script(`${base}/junk/v1/audio/speech`, [{ id: "s1", beat: [{ fx: "narrate", narrate: "Hi" }] }]);
  await assert.rejects(synthesizeNarrations(junk, "en", dir, () => {}), (e: unknown) => {
    assert.ok(e instanceof AgentError);
    assert.equal(e.code, "TTS_FAILED");
    assert.match(e.message, /unusable audio/);
    return true;
  });
  assert.deepEqual(fs.readdirSync(dir), []);
});

test("engine down → TTS_UNAVAILABLE with an actionable hint", async () => {
  const down = script(deadEndpoint, [{ id: "s1", beat: [{ fx: "narrate", narrate: "Hi" }] }]);
  await assert.rejects(synthesizeNarrations(down, "en", newDir("down"), () => {}), (e: unknown) => {
    assert.ok(e instanceof AgentError);
    assert.equal(e.code, "TTS_UNAVAILABLE");
    assert.match(e.message, /not reachable/);
    assert.match(e.hint ?? "", /narascreen doctor/);
    assert.match(e.hint ?? "", /docker run/);
    return true;
  });
});
