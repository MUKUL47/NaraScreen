import { useCallback, useRef, useState } from "react";
import { useProjectStore } from "../../stores/useProjectStore";
import { assetUrl } from "../../lib/fileOps";
import type { TimelineAction } from "../../types";
import { LANG_CODES, LANG_LABELS, DEFAULT_VOICES } from "../../lib/voices";

const api = window.electronAPI;

export { LANG_CODES, LANG_LABELS, DEFAULT_VOICES };

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
      // Persist project (incl. tts.speed and narration text) so the main process reads fresh values
      await useProjectStore.getState().save();
      const langCode = LANG_CODES[lang] || "a";
      const result = await api.generateTTS(sessionDir, action.id, text, lang, currentVoice, langCode);
      updateAction(action.id, {
        audioPath: { ...action.audioPath, [lang]: result.audioPath },
      });
      setAudioDuration(result.duration);
    } catch (err) {
      console.error("TTS generation failed:", err);
      alert(`TTS failed: ${err instanceof Error ? err.message : String(err)}`);
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

  const ttsSpeed = project?.tts?.speed ?? 1;
  const handleSpeedChange = useCallback((speed: number) => {
    const proj = useProjectStore.getState().project;
    if (!proj) return;
    useProjectStore.setState({
      project: { ...proj, tts: { ...proj.tts, speed } },
      isDirty: true,
    });
  }, []);

  return (
    <div className="relative">
      {/* Loading overlay */}
      {ttsLoading && (
        <div className="absolute inset-0 z-10 bg-zinc-950/80 rounded flex items-center justify-center">
          <div className="flex flex-col items-center gap-2">
            <div className="w-5 h-5 border-2 border-zinc-400 border-t-transparent rounded-full animate-spin" />
            <span className="text-xs text-zinc-400">Generating audio...</span>
          </div>
        </div>
      )}

      <label className="block text-xs text-zinc-400 font-medium mb-1">
        {label || `Narration (${langLabel})`}
      </label>

      <textarea
        value={text}
        onChange={(e) => handleTextChange(e.target.value)}
        rows={2}
        placeholder={`${langLabel} narration...`}
        className="w-full bg-zinc-950 border border-zinc-700/50 rounded px-3 py-2 text-sm text-zinc-200 focus:outline-none focus:border-blue-400 resize-none"
      />

      {/* Voice + speed selectors */}
      <div className="mt-1 flex gap-1.5">
        {voices.length > 1 && (
          <select
            value={currentVoice}
            onChange={(e) => setSelectedVoice(e.target.value)}
            title="Voice"
            className="flex-1 bg-zinc-950 border border-zinc-700/50 rounded px-2 py-1 text-[11px] text-zinc-300 focus:outline-none focus:border-blue-400"
          >
            {voices.map((v) => (
              <option key={v} value={v}>{v}</option>
            ))}
          </select>
        )}
        <select
          value={ttsSpeed}
          onChange={(e) => handleSpeedChange(parseFloat(e.target.value))}
          title="Narration speed (applies to next regeneration)"
          className="bg-zinc-950 border border-zinc-700/50 rounded px-2 py-1 text-[11px] text-zinc-300 focus:outline-none focus:border-blue-400"
        >
          <option value={0.75}>0.75x</option>
          <option value={1}>1x</option>
          <option value={1.25}>1.25x</option>
          <option value={1.5}>1.5x</option>
          <option value={2}>2x</option>
        </select>
      </div>

      <div className="flex gap-2 mt-2">
        <button
          onClick={handleGenerateTTS}
          disabled={ttsLoading || !text?.trim()}
          className="flex-1 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 disabled:bg-zinc-800 disabled:text-zinc-500 text-white text-xs rounded"
        >
          {ttsLoading ? "Generating..." : `Generate Audio`}
        </button>
        {audioPath && (
          <>
            <button
              onClick={handlePlay}
              className="px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-white text-xs rounded"
              title="Play audio preview"
            >
              Play
            </button>
            <button
              onClick={handleStop}
              className="px-2 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-white text-xs rounded"
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
