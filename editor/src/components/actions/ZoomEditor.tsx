import { useCallback, useRef, useState } from "react";
import { useProjectStore } from "../../stores/useProjectStore";
import { LANG_CODES, LANG_LABELS, DEFAULT_VOICES } from "./AudioControls";
import { ALL_LANGUAGES } from "./NarrateEditor";
import { assetUrl } from "../../lib/fileOps";
import type { TimelineAction, ZoomTarget } from "../../types";

const api = window.electronAPI;

interface ZoomEditorProps {
  action: TimelineAction;
  onUpdate: (partial: Partial<TimelineAction>) => void;
}

/** Helper: merge legacy zoomRect/zoomRects into modern zoomTargets */
function getZoomTargets(action: TimelineAction): ZoomTarget[] {
  if (action.zoomTargets?.length) return action.zoomTargets;
  if (action.zoomRects?.length) return action.zoomRects.map((rect) => ({ rect }));
  if (action.zoomRect) return [{ rect: action.zoomRect }];
  return [];
}

export function ZoomEditor({ action, onUpdate }: ZoomEditorProps) {
  const drawingZoom = useProjectStore((s) => s.drawingZoom);
  const setDrawingZoom = useProjectStore((s) => s.setDrawingZoom);
  const viewport = useProjectStore((s) => s.project?.viewport);
  const languages = useProjectStore((s) => s.project?.tts?.languages) ?? ["en"];

  const targets = getZoomTargets(action);
  const isMultiZoom = targets.length > 1;

  const updateTarget = (index: number, partial: Partial<ZoomTarget>) => {
    const updated = targets.map((t, i) => (i === index ? { ...t, ...partial } : t));
    onUpdate({ zoomTargets: updated, zoomRect: undefined, zoomRects: undefined });
  };

  const removeTarget = (index: number) => {
    const updated = targets.filter((_, i) => i !== index);
    onUpdate({
      zoomTargets: updated.length > 0 ? updated : undefined,
      zoomRect: undefined,
      zoomRects: undefined,
    });
  };

  return (
    <>
      <div>
        <label className="block text-xs text-zinc-400 font-medium mb-1">
          Zoom Targets ({targets.length}) — played in sequence
        </label>
        <button
          onClick={() => setDrawingZoom(!drawingZoom)}
          className={`px-3 py-1.5 text-xs rounded w-full ${
            drawingZoom
              ? "bg-yellow-600 text-white"
              : "bg-zinc-800 hover:bg-zinc-700 text-zinc-300"
          }`}
        >
          {drawingZoom
            ? "Drawing... (click & drag on video)"
            : targets.length > 0
              ? "Add Another Zoom"
              : "Draw Zoom Region"}
        </button>
        {targets.length > 0 && (
          <div className="mt-1.5 space-y-2">
            {targets.map((target, i) => (
              <ZoomTargetItem
                key={i}
                index={i}
                target={target}
                actionId={action.id}
                viewport={viewport}
                languages={languages}
                showNarration={true}
                onUpdate={(partial) => updateTarget(i, partial)}
                onRemove={() => removeTarget(i)}
              />
            ))}
            <button
              onClick={() =>
                onUpdate({ zoomTargets: undefined, zoomRect: undefined, zoomRects: undefined })
              }
              className="text-[10px] text-red-400 hover:text-red-300"
            >
              Clear All
            </button>
          </div>
        )}
      </div>

      <div>
        <label className="block text-xs text-zinc-400 font-medium mb-1">
          Animation Duration (seconds)
        </label>
        <input
          type="number"
          value={action.zoomDuration ?? 1}
          onChange={(e) =>
            onUpdate({ zoomDuration: parseFloat(e.target.value) || 1 })
          }
          min={0.3}
          max={5}
          step={0.1}
          className="w-full bg-zinc-950 border border-zinc-700/50 rounded px-3 py-1.5 text-sm text-zinc-200 focus:outline-none focus:border-blue-400"
        />
      </div>

      <div>
        <label className="block text-xs text-zinc-400 font-medium mb-1">
          Hold Duration per zoom (seconds)
        </label>
        <input
          type="number"
          value={action.zoomHold ?? ""}
          onChange={(e) =>
            onUpdate({
              zoomHold: e.target.value ? parseFloat(e.target.value) : undefined,
            })
          }
          placeholder="Auto (audio duration or 3s)"
          min={0}
          step={0.5}
          className="w-full bg-zinc-950 border border-zinc-700/50 rounded px-3 py-1.5 text-sm text-zinc-200 focus:outline-none focus:border-blue-400"
        />
      </div>

      <div className="text-[10px] text-zinc-600 border-t border-zinc-800/50 pt-2">
        {targets.length <= 1
          ? `Flow: Zoom In (${action.zoomDuration ?? 1}s) → Hold (frozen + narration) → Zoom Out (${action.zoomDuration ?? 1}s)`
          : `Flow: ${targets.map((_, i) => `Zoom ${i + 1}`).join(" → ")} — each: In → Hold (narration) → Out`}
      </div>
    </>
  );
}

/** Individual zoom target: rect info + per-target narration with full audio controls */
function ZoomTargetItem({
  index,
  target,
  actionId,
  viewport,
  languages,
  showNarration,
  onUpdate,
  onRemove,
}: {
  index: number;
  target: ZoomTarget;
  actionId: string;
  viewport?: { width: number; height: number };
  languages: string[];
  showNarration: boolean;
  onUpdate: (partial: Partial<ZoomTarget>) => void;
  onRemove: () => void;
}) {
  const project = useProjectStore((s) => s.project);
  const [expanded, setExpanded] = useState(false);
  const [activeLang, setActiveLang] = useState(languages[0] || "en");

  const r = target.rect;
  const zoomScale = viewport
    ? Math.min(viewport.width / r[2], viewport.height / r[3]).toFixed(1)
    : null;

  const currentLang = languages.includes(activeLang) ? activeLang : languages[0] || "en";
  const hasAnyNarration = languages.some((l) => target.narrations?.[l]);
  const hasAnyAudio = languages.some((l) => target.audioPath?.[l]);

  const handleAddLang = (code: string) => {
    if (!project) return;
    if (languages.includes(code)) {
      setActiveLang(code);
      return;
    }
    const updated = [...languages, code];
    useProjectStore.setState({
      project: { ...project, tts: { ...project.tts, languages: updated } },
      isDirty: true,
    });
    setActiveLang(code);
  };

  const handleRemoveLang = () => {
    if (!project || languages.length <= 1) return;
    const updated = languages.filter((l) => l !== currentLang);
    useProjectStore.setState({
      project: { ...project, tts: { ...project.tts, languages: updated } },
      isDirty: true,
    });
    setActiveLang(updated[0]);
  };

  return (
    <div className="bg-zinc-900 rounded overflow-hidden">
      {/* Header row */}
      <div className="flex items-center justify-between px-2 py-1">
        <button
          onClick={() => showNarration && setExpanded(!expanded)}
          className={`flex items-center gap-1.5 text-[10px] text-zinc-400 font-mono ${showNarration ? "hover:text-zinc-200 cursor-pointer" : "cursor-default"}`}
        >
          {showNarration && <span className="text-[8px]">{expanded ? "\u25BC" : "\u25B6"}</span>}
          #{index + 1}: {r[0]},{r[1]} {r[2]}x{r[3]}
          {zoomScale && <span className="text-violet-400">{zoomScale}x</span>}
          {showNarration && hasAnyNarration && <span className="text-emerald-400 ml-1">narration</span>}
          {showNarration && hasAnyAudio && <span className="text-blue-400 ml-1">audio</span>}
        </button>
        <button
          onClick={onRemove}
          className="text-[10px] text-red-400 hover:text-red-300"
        >
          Remove
        </button>
      </div>

      {/* Expanded: per-target narration with full audio controls */}
      {showNarration && expanded && (
        <div className="px-2 pb-2 space-y-1.5">
          {/* Language dropdown with add/remove — same as NarrateEditor */}
          <div className="flex items-center gap-1">
            <select
              value={currentLang}
              onChange={(e) => handleAddLang(e.target.value)}
              className="flex-1 bg-zinc-950 border border-zinc-700/50 rounded px-2 py-0.5 text-[10px] text-zinc-300 focus:outline-none focus:border-violet-500"
            >
              {/* Active languages */}
              {languages.map((lang) => {
                const info = ALL_LANGUAGES.find((l) => l.code === lang);
                return (
                  <option key={lang} value={lang}>
                    {info?.label || lang}
                    {target.audioPath?.[lang] ? " ✓" : ""}
                  </option>
                );
              })}
              {/* Separator + available languages */}
              {ALL_LANGUAGES.filter((l) => !languages.includes(l.code)).length > 0 && (
                <option disabled>── Add language ──</option>
              )}
              {ALL_LANGUAGES.filter((l) => !languages.includes(l.code)).map((l) => (
                <option key={l.code} value={l.code}>
                  + {l.label}
                </option>
              ))}
            </select>

            {languages.length > 1 && (
              <button
                onClick={handleRemoveLang}
                className="px-1 py-0.5 text-[9px] text-red-400 hover:text-red-300 hover:bg-red-900/30 rounded"
                title={`Remove ${ALL_LANGUAGES.find((l) => l.code === currentLang)?.label || currentLang}`}
              >
                Remove
              </button>
            )}
          </div>

          <ZoomTargetAudioControls
            key={currentLang}
            target={target}
            actionId={actionId}
            targetIndex={index}
            lang={currentLang}
            onUpdate={onUpdate}
          />
        </div>
      )}
    </div>
  );
}

/** Full audio controls for a single zoom target + language: text, voice, generate, play */
function ZoomTargetAudioControls({
  target,
  actionId,
  targetIndex,
  lang,
  onUpdate,
}: {
  target: ZoomTarget;
  actionId: string;
  targetIndex: number;
  lang: string;
  onUpdate: (partial: Partial<ZoomTarget>) => void;
}) {
  const sessionDir = useProjectStore((s) => s.sessionDir);
  const project = useProjectStore((s) => s.project);

  const [ttsLoading, setTtsLoading] = useState(false);
  const [audioDuration, setAudioDuration] = useState<number | null>(null);
  const [selectedVoice, setSelectedVoice] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const text = target.narrations?.[lang] ?? "";
  const audioPath = target.audioPath?.[lang];

  // Voices
  const projectVoices = project?.tts?.voices?.[lang];
  const voices = projectVoices?.length ? projectVoices : (DEFAULT_VOICES[lang] || []);
  const currentVoice =
    selectedVoice ??
    (lang === "en" ? project?.tts?.voiceEn : undefined) ??
    (lang === "hi" ? project?.tts?.voiceHi : undefined) ??
    voices[0] ??
    "af_heart";

  const handleTextChange = useCallback(
    (value: string) => {
      onUpdate({
        narrations: { ...target.narrations, [lang]: value || undefined } as Record<string, string>,
      });
    },
    [target.narrations, lang, onUpdate],
  );

  const handleGenerateTTS = useCallback(async () => {
    if (!text?.trim() || !sessionDir) return;
    setTtsLoading(true);
    try {
      const langCode = LANG_CODES[lang] || "a";
      // Use a unique ID: actionId_zoom_targetIndex_lang
      const audioId = `${actionId}_zoom${targetIndex}_${lang}`;
      const result = await api.generateTTS(sessionDir, audioId, text, lang, currentVoice, langCode);
      onUpdate({
        audioPath: { ...target.audioPath, [lang]: result.audioPath },
      });
      setAudioDuration(result.duration);
    } catch (err) {
      console.error("TTS generation failed:", err);
      alert(`TTS failed: ${err}`);
    } finally {
      setTtsLoading(false);
    }
  }, [text, sessionDir, actionId, targetIndex, target.audioPath, lang, currentVoice, onUpdate]);

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
      {ttsLoading && (
        <div className="absolute inset-0 z-10 bg-zinc-950/70 rounded flex items-center justify-center backdrop-blur-sm">
          <div className="flex flex-col items-center gap-2">
            <div className="w-5 h-5 border-2 border-emerald-400 border-t-transparent rounded-full animate-spin" />
            <span className="text-[10px] text-emerald-400">Generating...</span>
          </div>
        </div>
      )}

      <textarea
        value={text}
        onChange={(e) => handleTextChange(e.target.value)}
        rows={2}
        placeholder={`${langLabel} narration for zoom #${targetIndex + 1}...`}
        className="w-full bg-zinc-950 border border-zinc-700/50 rounded px-2 py-1.5 text-[11px] text-zinc-200 focus:outline-none focus:border-blue-400 resize-none"
      />

      {/* Voice selector */}
      {voices.length > 1 && (
        <select
          value={currentVoice}
          onChange={(e) => setSelectedVoice(e.target.value)}
          className="w-full bg-zinc-950 border border-zinc-700/50 rounded px-2 py-0.5 text-[10px] text-zinc-300 focus:outline-none focus:border-blue-400 mt-1"
        >
          {voices.map((v) => (
            <option key={v} value={v}>{v}</option>
          ))}
        </select>
      )}

      <div className="flex gap-1.5 mt-1.5">
        <button
          onClick={handleGenerateTTS}
          disabled={ttsLoading || !text?.trim()}
          className="flex-1 px-2 py-1 bg-emerald-600 hover:bg-emerald-500 disabled:bg-zinc-800 disabled:text-zinc-500 text-white text-[10px] rounded"
        >
          {ttsLoading ? "Generating..." : "Generate"}
        </button>
        {audioPath && (
          <>
            <button
              onClick={handlePlay}
              className="px-2 py-1 bg-zinc-800 hover:bg-zinc-700 text-white text-[10px] rounded"
            >
              Play
            </button>
            <button
              onClick={handleStop}
              className="px-1.5 py-1 bg-zinc-800 hover:bg-zinc-700 text-white text-[10px] rounded"
            >
              Stop
            </button>
          </>
        )}
      </div>

      {audioPath && (
        <div className="text-[9px] text-emerald-400 mt-0.5">
          Audio ready {audioDuration ? `(${audioDuration.toFixed(1)}s)` : ""}
        </div>
      )}
    </div>
  );
}
