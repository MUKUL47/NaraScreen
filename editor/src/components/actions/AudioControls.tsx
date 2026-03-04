import { useCallback, useRef, useState } from "react";
import { useProjectStore } from "../../stores/useProjectStore";
import { assetUrl } from "../../lib/fileOps";
import type { TimelineAction } from "../../types";

const api = window.electronAPI;

/** Kokoro lang codes for each language */
const LANG_CODES: Record<string, string> = {
  en: "a", "en-gb": "b", hi: "h", es: "e", fr: "f", ja: "j", zh: "z",
  pt: "p", it: "i",
};

const LANG_LABELS: Record<string, string> = {
  en: "English", "en-gb": "British English", hi: "Hindi", es: "Spanish",
  fr: "French", ja: "Japanese", zh: "Chinese", pt: "Brazilian Portuguese", it: "Italian",
};

/** Default voices per language (Kokoro voice IDs) */
const DEFAULT_VOICES: Record<string, string[]> = {
  en: ["af_heart", "af_bella", "af_alloy", "af_aoede", "af_jessica", "af_kore", "af_nicole", "af_nova", "af_river", "af_sarah", "af_sky", "am_adam", "am_echo", "am_eric", "am_fenrir", "am_liam", "am_michael", "am_onyx", "am_puck", "am_santa"],
  "en-gb": ["bf_alice", "bf_emma", "bf_isabella", "bf_lily", "bm_daniel", "bm_fable", "bm_george", "bm_lewis"],
  hi: ["hf_alpha", "hf_beta", "hm_omega", "hm_psi"],
  es: ["ef_dora", "em_alex", "em_santa"],
  fr: ["ff_siwis"],
  ja: ["jf_alpha", "jf_gongitsune", "jf_nezumi", "jf_tebukuro", "jm_kumo"],
  zh: ["zf_xiaobei", "zf_xiaoni", "zf_xiaoxiao", "zf_xiaoyi", "zm_yunjian", "zm_yunxi", "zm_yunxia", "zm_yunyang"],
  pt: ["pf_dora", "pm_alex", "pm_santa"],
  it: ["if_sara", "im_nicola"],
};

interface AudioControlsProps {
  action: TimelineAction;
  lang: string;
  label?: string;
}

export function AudioControls({ action, lang, label }: AudioControlsProps) {
  const sessionDir = useProjectStore((s) => s.sessionDir);
  const updateAction = useProjectStore((s) => s.updateAction);
  const project = useProjectStore((s) => s.project);

  const [ttsLoading, setTtsLoading] = useState(false);
  const [audioDuration, setAudioDuration] = useState<number | null>(null);
  const [selectedVoice, setSelectedVoice] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Get narration text — check narrations record first, then legacy fields
  const text =
    action.narrations?.[lang] ??
    (lang === "en" ? action.narration : undefined) ??
    (lang === "hi" ? action.narration_hi : undefined) ??
    "";

  const audioPath = action.audioPath?.[lang];

  // Available voices for this language
  const projectVoices = project?.tts?.voices?.[lang];
  const voices = projectVoices?.length ? projectVoices : (DEFAULT_VOICES[lang] || []);

  // Current voice: selected override > project default > first available
  const currentVoice =
    selectedVoice ??
    (lang === "en" ? project?.tts?.voiceEn : undefined) ??
    (lang === "hi" ? project?.tts?.voiceHi : undefined) ??
    voices[0] ??
    "af_heart";

  const handleTextChange = useCallback(
    (value: string) => {
      // Write to narrations record + legacy fields for compat
      const updates: Partial<TimelineAction> = {
        narrations: { ...action.narrations, [lang]: value || undefined } as Record<string, string>,
      };
      if (lang === "en") updates.narration = value || undefined;
      if (lang === "hi") updates.narration_hi = value || undefined;
      updateAction(action.id, updates);
    },
    [action.id, action.narrations, lang, updateAction],
  );

  const handleGenerateTTS = useCallback(async () => {
    if (!text?.trim() || !sessionDir) return;
    setTtsLoading(true);
    try {
      const langCode = LANG_CODES[lang] || "a";
      const result = await api.generateTTS(sessionDir, action.id, text, lang, currentVoice, langCode);
      updateAction(action.id, {
        audioPath: { ...action.audioPath, [lang]: result.audioPath },
      });
      setAudioDuration(result.duration);
    } catch (err) {
      console.error("TTS generation failed:", err);
      alert(`TTS failed: ${err}`);
    } finally {
      setTtsLoading(false);
    }
  }, [text, sessionDir, action.id, action.audioPath, lang, currentVoice, updateAction]);

  const handlePlay = useCallback(() => {
    if (!audioPath) return;
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
    const audio = new Audio(assetUrl(audioPath) + `?t=${Date.now()}`);
    audioRef.current = audio;
    audio.play();
    audio.onended = () => { audioRef.current = null; };
  }, [audioPath]);

  const handleStop = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
  }, []);

  const langLabel = LANG_LABELS[lang] || lang.toUpperCase();

  return (
    <div className="relative">
      {/* Loading overlay */}
      {ttsLoading && (
        <div className="absolute inset-0 z-10 bg-slate-900/70 rounded flex items-center justify-center backdrop-blur-sm">
          <div className="flex flex-col items-center gap-2">
            <div className="w-6 h-6 border-2 border-emerald-400 border-t-transparent rounded-full animate-spin" />
            <span className="text-xs text-emerald-400">Generating audio...</span>
          </div>
        </div>
      )}

      <label className="block text-xs text-slate-400 font-medium mb-1">
        {label || `Narration (${langLabel})`}
      </label>

      <textarea
        value={text}
        onChange={(e) => handleTextChange(e.target.value)}
        rows={2}
        placeholder={`${langLabel} narration...`}
        className="w-full bg-slate-900 border border-slate-600 rounded px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-blue-400 resize-none"
      />

      {/* Voice selector */}
      {voices.length > 1 && (
        <div className="mt-1">
          <select
            value={currentVoice}
            onChange={(e) => setSelectedVoice(e.target.value)}
            className="w-full bg-slate-900 border border-slate-600 rounded px-2 py-1 text-[11px] text-slate-300 focus:outline-none focus:border-blue-400"
          >
            {voices.map((v) => (
              <option key={v} value={v}>{v}</option>
            ))}
          </select>
        </div>
      )}

      <div className="flex gap-2 mt-2">
        <button
          onClick={handleGenerateTTS}
          disabled={ttsLoading || !text?.trim()}
          className="flex-1 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-700 disabled:text-slate-500 text-white text-xs rounded"
        >
          {ttsLoading ? "Generating..." : `Generate Audio`}
        </button>
        {audioPath && (
          <>
            <button
              onClick={handlePlay}
              className="px-3 py-1.5 bg-slate-700 hover:bg-slate-600 text-white text-xs rounded"
              title="Play audio preview"
            >
              Play
            </button>
            <button
              onClick={handleStop}
              className="px-2 py-1.5 bg-slate-700 hover:bg-slate-600 text-white text-xs rounded"
              title="Stop"
            >
              Stop
            </button>
          </>
        )}
      </div>

      {audioPath && (
        <div className="text-[10px] text-emerald-400 mt-1">
          Audio ready {audioDuration ? `(${audioDuration.toFixed(1)}s)` : ""}
        </div>
      )}

    </div>
  );
}
