import { spawnSync } from "child_process";
import * as path from "path";
import * as fs from "fs";
import https from "https";
import http from "http";

// ─── Path Resolution ────────────────────────────────────────

const IS_PACKAGED = !process.defaultApp && !process.execPath.includes("node_modules");

/** Get userData path — works in both main process and worker threads */
function getUserDataPath(): string {
  if (process.env.ELECTRON_USER_DATA) return process.env.ELECTRON_USER_DATA;
  try {
    const { app } = require("electron");
    if (app?.getPath) return app.getPath("userData");
  } catch {}
  const home = process.env.HOME || process.env.USERPROFILE || "/tmp";
  return path.join(home, ".config", "narascreen-editor");
}

/** Resolve Python with ctranslate2 + sentencepiece installed */
function resolveTranslatePython(): string {
  if (process.env.TRANSLATE_PYTHON) return process.env.TRANSLATE_PYTHON;

  if (IS_PACKAGED && process.resourcesPath) {
    const ext = process.platform === "win32" ? ".exe" : "";
    const venvPython = path.join(process.resourcesPath, "translate-venv", "bin", "python3" + ext);
    const venvPythonWin = path.join(process.resourcesPath, "translate-venv", "Scripts", "python" + ext);
    if (fs.existsSync(venvPython)) return venvPython;
    if (fs.existsSync(venvPythonWin)) return venvPythonWin;
  }

  // Check local project translate-venv
  const localVenv = path.join(__dirname, "..", "translate-venv", "bin", "python3");
  if (fs.existsSync(localVenv)) return localVenv;

  return "python3";
}

/** Get the directory for cached translation models */
function getTranslationModelsDir(): string {
  const dir = path.join(getUserDataPath(), "narascreen-models", "translation");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

// ─── OPUS-MT language code mapping ──────────────────────────

/** Map our language codes to OPUS-MT model language codes */
const OPUS_LANG_MAP: Record<string, string> = {
  en: "en",
  hi: "hi",
  es: "es",
  fr: "fr",
  de: "de",
  it: "it",
  pt: "pt",
  ja: "ja",
  zh: "zh",
  ru: "ru",
  ko: "ko",
  ar: "ar",
  tr: "tr",
  pl: "pl",
  nl: "nl",
  sv: "sv",
  no: "nb",  // Norwegian Bokmål
  da: "da",
  fi: "fi",
  el: "el",
  cs: "cs",
  uk: "uk",
  vi: "vi",
  ro: "ro",
  hu: "hu",
  sk: "sk",
  bg: "bg",
  hr: "hr",
  sr: "sr",
  sl: "sl",
  lt: "lt",
  lv: "lv",
  et: "et",
  ka: "ka",
  th: "th",
  id: "id",
  ms: "ms",
  ca: "ca",
  "en-gb": "en",
};

function opusLang(lang: string): string {
  return OPUS_LANG_MAP[lang] || lang;
}

// ─── Model Management ───────────────────────────────────────

/** Get the model directory path for a language pair */
function getModelDir(srcLang: string, tgtLang: string): string {
  const src = opusLang(srcLang);
  const tgt = opusLang(tgtLang);
  return path.join(getTranslationModelsDir(), `opus-mt-${src}-${tgt}`);
}

/**
 * Check if translation is possible for a language pair.
 * Supports direct models and pivot through English.
 */
export function isTranslationModelAvailable(srcLang: string, tgtLang: string): boolean {
  const src = opusLang(srcLang);
  const tgt = opusLang(tgtLang);
  if (src === tgt) return true;

  // Direct model available
  const directDir = getModelDir(srcLang, tgtLang);
  if (fs.existsSync(path.join(directDir, "model.bin"))) return true;

  // Pivot through English: src→en + en→tgt
  if (src !== "en" && tgt !== "en") {
    const srcEnDir = getModelDir(srcLang, "en");
    const enTgtDir = getModelDir("en", tgtLang);
    return fs.existsSync(path.join(srcEnDir, "model.bin")) &&
           fs.existsSync(path.join(enTgtDir, "model.bin"));
  }

  return false;
}

/**
 * Get the models needed for a translation pair.
 * Returns array of [src, tgt] pairs to download.
 */
export function getRequiredModels(srcLang: string, tgtLang: string): [string, string][] {
  const src = opusLang(srcLang);
  const tgt = opusLang(tgtLang);
  if (src === tgt) return [];

  // Check if direct model exists or can be downloaded
  const directDir = getModelDir(srcLang, tgtLang);
  if (fs.existsSync(path.join(directDir, "model.bin"))) return [];

  // For non-English pairs, use pivot through English
  if (src !== "en" && tgt !== "en") {
    const pairs: [string, string][] = [];
    const srcEnDir = getModelDir(srcLang, "en");
    if (!fs.existsSync(path.join(srcEnDir, "model.bin"))) pairs.push([srcLang, "en"]);
    const enTgtDir = getModelDir("en", tgtLang);
    if (!fs.existsSync(path.join(enTgtDir, "model.bin"))) pairs.push(["en", tgtLang]);
    return pairs;
  }

  // Direct pair needed
  return [[srcLang, tgtLang]];
}

/** Resolve a redirect Location header against the original URL */
function resolveRedirect(originalUrl: string, location: string): string {
  if (location.startsWith("http://") || location.startsWith("https://")) {
    return location;
  }
  const parsed = new URL(originalUrl);
  return `${parsed.protocol}//${parsed.host}${location}`;
}

/** Download a file from URL to dest, following redirects */
function downloadFile(url: string, dest: string, emit?: (msg: string) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const handler = (res: http.IncomingMessage) => {
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return downloadFile(resolveRedirect(url, res.headers.location), dest, emit).then(resolve, reject);
      }
      if (res.statusCode && res.statusCode >= 400) {
        return reject(new Error(`HTTP ${res.statusCode} downloading ${url}`));
      }
      const totalSize = parseInt(res.headers["content-length"] || "0", 10);
      let downloaded = 0;
      const file = fs.createWriteStream(dest);
      res.on("data", (chunk: Buffer) => {
        downloaded += chunk.length;
        file.write(chunk);
        if (totalSize > 0 && emit) {
          const pct = ((downloaded / totalSize) * 100).toFixed(0);
          emit(`  Downloading... ${pct}% (${(downloaded / 1024 / 1024).toFixed(1)} MB)`);
        }
      });
      res.on("end", () => file.end(() => resolve()));
      res.on("error", (err) => { file.close(); try { fs.unlinkSync(dest); } catch {} reject(err); });
    };
    if (url.startsWith("https")) {
      https.get(url, handler).on("error", reject);
    } else {
      http.get(url, handler).on("error", reject);
    }
  });
}

/** Files needed from the pre-converted CT2 model repo */
const CT2_MODEL_FILES = [
  "model.bin",
  "source.spm",
  "target.spm",
  "vocab.json",
  "shared_vocabulary.json",
  "tokenizer_config.json",
];

/** Download a single direct model (pre-converted CT2 or fallback to conversion) */
async function downloadDirectModel(
  src: string,
  tgt: string,
  modelDir: string,
  emit?: (msg: string) => void,
): Promise<boolean> {
  if (fs.existsSync(path.join(modelDir, "model.bin"))) return true;

  fs.mkdirSync(modelDir, { recursive: true });

  // Try pre-converted CT2 repos (no PyTorch needed)
  const ct2Repos = [
    `gaudi/opus-mt-${src}-${tgt}-ctranslate2`,
    `michaelfeil/ct2fast-opus-mt-${src}-${tgt}`,
  ];

  for (const repo of ct2Repos) {
    try {
      emit?.(`  Trying ${repo}...`);
      const baseUrl = `https://huggingface.co/${repo}/resolve/main`;
      await downloadFile(`${baseUrl}/model.bin`, path.join(modelDir, "model.bin"), emit);
      for (const file of CT2_MODEL_FILES) {
        if (file === "model.bin") continue;
        try { await downloadFile(`${baseUrl}/${file}`, path.join(modelDir, file)); } catch {}
      }
      return true;
    } catch {
      emit?.(`  ${repo} not available, trying next...`);
      for (const file of CT2_MODEL_FILES) {
        try { fs.unlinkSync(path.join(modelDir, file)); } catch {}
      }
    }
  }

  // Fallback: convert via ctranslate2 + transformers (needs PyTorch)
  try {
    emit?.(`  Converting Helsinki-NLP/opus-mt-${src}-${tgt}...`);
    const python = resolveTranslatePython();
    const pyScript = `
import sys, os, json
src, tgt, output_dir = sys.argv[1], sys.argv[2], sys.argv[3]
model_name = f"Helsinki-NLP/opus-mt-{src}-{tgt}"
try:
    import ctranslate2
    from transformers import MarianTokenizer
    converter = ctranslate2.converters.TransformersConverter(model_name)
    converter.convert(output_dir, force=True)
    tokenizer = MarianTokenizer.from_pretrained(model_name)
    tokenizer.save_pretrained(output_dir)
    # Fix config.json: remove null values that crash CTranslate2
    config_path = os.path.join(output_dir, "config.json")
    if os.path.exists(config_path):
        with open(config_path) as f:
            config = json.load(f)
        config = {k: v for k, v in config.items() if v is not None}
        with open(config_path, "w") as f:
            json.dump(config, f, indent=2)
    print(json.dumps({"status": "ok", "files": os.listdir(output_dir)}))
except Exception as e:
    print(json.dumps({"status": "error", "message": str(e)}), file=sys.stderr)
    sys.exit(1)
`;
    const result = spawnSync(python, ["-c", pyScript, src, tgt, modelDir], {
      timeout: 300000, encoding: "utf-8",
    });
    if (result.status === 0 && fs.existsSync(path.join(modelDir, "model.bin"))) {
      return true;
    }
  } catch {}

  // Clean up failed attempt
  try { fs.rmSync(modelDir, { recursive: true }); } catch {}
  return false;
}

/**
 * Download translation model for a language pair.
 * Tries direct model first, then pivot through English (downloads both legs).
 */
export async function downloadTranslationModel(
  srcLang: string,
  tgtLang: string,
  emit?: (msg: string) => void,
): Promise<string> {
  const src = opusLang(srcLang);
  const tgt = opusLang(tgtLang);
  if (src === tgt) return "";

  // Already have direct model?
  const directDir = getModelDir(srcLang, tgtLang);
  if (fs.existsSync(path.join(directDir, "model.bin"))) {
    emit?.(`Translation model ${src} → ${tgt} already available`);
    return directDir;
  }

  emit?.(`Downloading translation model: ${src} → ${tgt}...`);

  // Try direct download
  if (await downloadDirectModel(src, tgt, directDir, emit)) {
    emit?.(`Translation model ${src} → ${tgt} ready`);
    return directDir;
  }

  // Pivot through English for non-English pairs
  if (src !== "en" && tgt !== "en") {
    emit?.(`  Direct model not available. Using pivot: ${src} → en → ${tgt}`);

    const srcEnDir = getModelDir(srcLang, "en");
    const enTgtDir = getModelDir("en", tgtLang);

    emit?.(`  Downloading ${src} → en...`);
    if (!await downloadDirectModel(src, "en", srcEnDir, emit)) {
      throw new Error(`Failed to download translation model ${src}→en`);
    }

    emit?.(`  Downloading en → ${tgt}...`);
    if (!await downloadDirectModel("en", tgt, enTgtDir, emit)) {
      throw new Error(`Failed to download translation model en→${tgt}`);
    }

    emit?.(`Translation models ready (pivot: ${src} → en → ${tgt})`);
    return srcEnDir; // Return first leg dir (caller uses isTranslationModelAvailable)
  }

  throw new Error(`No translation model available for ${src}→${tgt}`);
}

// ─── Translation ────────────────────────────────────────────

/** Translate a single text string (supports pivot through English) */
export function translateText(
  text: string,
  srcLang: string,
  tgtLang: string,
): string {
  if (!text.trim()) return "";
  const src = opusLang(srcLang);
  const tgt = opusLang(tgtLang);
  if (src === tgt) return text;

  // Try direct translation
  const directDir = getModelDir(srcLang, tgtLang);
  if (fs.existsSync(path.join(directDir, "model.bin"))) {
    return translateDirect(text, directDir);
  }

  // Pivot through English
  if (src !== "en" && tgt !== "en") {
    const srcEnDir = getModelDir(srcLang, "en");
    const enTgtDir = getModelDir("en", tgtLang);
    if (fs.existsSync(path.join(srcEnDir, "model.bin")) && fs.existsSync(path.join(enTgtDir, "model.bin"))) {
      const english = translateDirect(text, srcEnDir);
      return translateDirect(english, enTgtDir);
    }
  }

  throw new Error(`Translation model not available for ${srcLang}→${tgtLang}. Download it first.`);
}

/** Direct translation using a single model directory */
function translateDirect(text: string, modelDir: string): string {

  const python = resolveTranslatePython();

  const pyScript = `
import sys, json, os
import ctranslate2
import sentencepiece as spm

model_dir = sys.argv[1]
text = sys.argv[2]

translator = ctranslate2.Translator(model_dir, device="cpu")

# Find SentencePiece model
sp_src = None
sp_tgt = None
for sp_file in ["source.spm", "sentencepiece.bpe.model", "tokenizer.model"]:
    sp_path = os.path.join(model_dir, sp_file)
    if os.path.exists(sp_path):
        sp_src = spm.SentencePieceProcessor(sp_path)
        # Try target.spm for decoding, fall back to source
        tgt_path = os.path.join(model_dir, "target.spm")
        sp_tgt = spm.SentencePieceProcessor(tgt_path) if os.path.exists(tgt_path) else sp_src
        break

if not sp_src:
    print(json.dumps({"error": "No SentencePiece model found"}), file=sys.stderr)
    sys.exit(1)

tokens = sp_src.encode(text, out_type=str)
max_len = max(int(len(tokens) * 2.5), 50)
results = translator.translate_batch(
    [tokens],
    beam_size=4,
    max_decoding_length=max_len,
    repetition_penalty=1.5,
    no_repeat_ngram_size=3,
)
output = sp_tgt.decode(results[0].hypotheses[0])

print(json.dumps({"translated": output}))
`;

  const result = spawnSync(python, [
    "-c", pyScript, modelDir, text,
  ], { timeout: 60000, encoding: "utf-8" });

  if (result.status !== 0) {
    throw new Error(`Translation failed: ${(result.stderr || "").slice(0, 500)}`);
  }

  try {
    const parsed = JSON.parse(result.stdout.trim());
    return parsed.translated || text;
  } catch {
    throw new Error(`Translation output parse error: ${result.stdout.slice(0, 200)}`);
  }
}

/** Batch translate multiple texts (supports pivot through English) */
export function translateBatch(
  texts: string[],
  srcLang: string,
  tgtLang: string,
): string[] {
  if (texts.length === 0) return [];
  const src = opusLang(srcLang);
  const tgt = opusLang(tgtLang);
  if (src === tgt) return [...texts];

  // Try direct translation
  const directDir = getModelDir(srcLang, tgtLang);
  if (fs.existsSync(path.join(directDir, "model.bin"))) {
    return translateBatchDirect(texts, directDir);
  }

  // Pivot through English
  if (src !== "en" && tgt !== "en") {
    const srcEnDir = getModelDir(srcLang, "en");
    const enTgtDir = getModelDir("en", tgtLang);
    if (fs.existsSync(path.join(srcEnDir, "model.bin")) && fs.existsSync(path.join(enTgtDir, "model.bin"))) {
      const english = translateBatchDirect(texts, srcEnDir);
      return translateBatchDirect(english, enTgtDir);
    }
  }

  throw new Error(`Translation model not available for ${srcLang}→${tgtLang}. Download it first.`);
}

/** Batch translate using a single model directory */
function translateBatchDirect(texts: string[], modelDir: string): string[] {

  const python = resolveTranslatePython();

  const pyScript = `
import sys, json, os
import ctranslate2
import sentencepiece as spm

model_dir = sys.argv[1]
texts = json.loads(sys.argv[2])

translator = ctranslate2.Translator(model_dir, device="cpu")

# Find SentencePiece model
sp_src = None
sp_tgt = None
for sp_file in ["source.spm", "sentencepiece.bpe.model", "tokenizer.model"]:
    sp_path = os.path.join(model_dir, sp_file)
    if os.path.exists(sp_path):
        sp_src = spm.SentencePieceProcessor(sp_path)
        tgt_path = os.path.join(model_dir, "target.spm")
        sp_tgt = spm.SentencePieceProcessor(tgt_path) if os.path.exists(tgt_path) else sp_src
        break

if not sp_src:
    print(json.dumps({"error": "No SentencePiece model found"}), file=sys.stderr)
    sys.exit(1)

translated_map = {}
for i, text in enumerate(texts):
    if not text.strip():
        continue
    tokens = sp_src.encode(text, out_type=str)
    if not tokens:
        continue
    max_len = max(int(len(tokens) * 2.5), 50)
    results = translator.translate_batch(
        [tokens],
        beam_size=4,
        max_decoding_length=max_len,
        repetition_penalty=1.5,
        no_repeat_ngram_size=3,
    )
    translated_map[i] = sp_tgt.decode(results[0].hypotheses[0])

results_out = [translated_map.get(i, texts[i]) for i in range(len(texts))]
print(json.dumps({"translated": results_out}))
`;

  const result = spawnSync(python, [
    "-c", pyScript, modelDir, JSON.stringify(texts),
  ], { timeout: 120000, encoding: "utf-8", maxBuffer: 10 * 1024 * 1024 });

  if (result.status !== 0) {
    throw new Error(`Batch translation failed: ${(result.stderr || "").slice(0, 500)}`);
  }

  try {
    const parsed = JSON.parse(result.stdout.trim());
    return parsed.translated || texts;
  } catch {
    throw new Error(`Batch translation parse error: ${result.stdout.slice(0, 200)}`);
  }
}
