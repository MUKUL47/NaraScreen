import { useState, useCallback, useRef } from "react";
import { useProjectStore } from "../../stores/useProjectStore";
import { AudioControls } from "./AudioControls";
import { assetUrl } from "../../lib/fileOps";
import type { TimelineAction } from "../../types";

const api = window.electronAPI;

export const ALL_LANGUAGES: { code: string; label: string }[] = [
  { code: "en", label: "English" },
  { code: "en-gb", label: "British English" },
  { code: "hi", label: "Hindi" },
  { code: "es", label: "Spanish" },
  { code: "fr", label: "French" },
  { code: "ja", label: "Japanese" },
  { code: "zh", label: "Chinese" },
  { code: "pt", label: "Brazilian Portuguese" },
  { code: "it", label: "Italian" },
];

/** Shared language dropdown + AudioControls for any action editor */
export function LanguageAudioSection({
  action,
  label,
}: {
  action: TimelineAction;
  label?: string;
}) {
  const languages = useProjectStore((s) => s.project?.tts?.languages) ?? ["en"];
  const project = useProjectStore((s) => s.project);
  const [activeLang, setActiveLang] = useState(languages[0] || "en");

  const currentLang = languages.includes(activeLang) ? activeLang : languages[0] || "en";

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
    <>
      {label && (
        <label className="block text-xs text-slate-400 font-medium mb-1">{label}</label>
      )}

      {/* Language dropdown */}
      <div className="flex items-center gap-1.5 mb-2">
        <select
          value={currentLang}
          onChange={(e) => handleAddLang(e.target.value)}
          className="flex-1 bg-slate-900 border border-slate-600 rounded px-2 py-1 text-xs text-slate-200 focus:outline-none focus:border-violet-500"
        >
          {/* Active languages first */}
          {languages.map((lang) => {
            const info = ALL_LANGUAGES.find((l) => l.code === lang);
            return (
              <option key={lang} value={lang}>
                {info?.label || lang}
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
            className="px-1.5 py-1 text-[10px] text-red-400 hover:text-red-300 hover:bg-red-900/30 rounded"
            title={`Remove ${ALL_LANGUAGES.find((l) => l.code === currentLang)?.label || currentLang}`}
          >
            Remove
          </button>
        )}
      </div>

      <AudioControls
        key={currentLang}
        action={action}
        lang={currentLang}
      />
    </>
  );
}

interface NarrateEditorProps {
  action: TimelineAction;
}

export function NarrateEditor({ action }: NarrateEditorProps) {
  const updateAction = useProjectStore((s) => s.updateAction);
  const sessionDir = useProjectStore((s) => s.sessionDir);
  const [audioMode, setAudioMode] = useState<"tts" | "record">(action.customAudioPath ? "record" : "tts");
  const [recording, setRecording] = useState(false);
  const [recordedUrl, setRecordedUrl] = useState<string | null>(
    action.customAudioPath ? assetUrl(action.customAudioPath) : null,
  );
  const [recordedDuration, setRecordedDuration] = useState<number | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const playbackRef = useRef<HTMLAudioElement | null>(null);

  // Voice recording handlers
  const handleStartRecording = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      chunksRef.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.onstop = async () => {
        const blob = new Blob(chunksRef.current, { type: "audio/webm" });
        stream.getTracks().forEach((t) => t.stop());
        if (!sessionDir) return;
        const filePath = `${sessionDir}/audio/${action.id}_voice.webm`;
        const arrayBuffer = await blob.arrayBuffer();
        await api.writeBinaryFile(filePath, arrayBuffer);
        updateAction(action.id, { customAudioPath: filePath });
        const url = assetUrl(filePath);
        setRecordedUrl(url);
        const audio = new Audio(url);
        audio.onloadedmetadata = () => setRecordedDuration(audio.duration);
      };
      mediaRecorderRef.current = recorder;
      recorder.start();
      setRecording(true);
    } catch (err) {
      console.error("Microphone access denied:", err);
    }
  }, [sessionDir, action.id, updateAction]);

  const handleStopRecording = useCallback(() => {
    mediaRecorderRef.current?.stop();
    setRecording(false);
  }, []);

  const handlePlayRecorded = useCallback(() => {
    if (!recordedUrl) return;
    playbackRef.current?.pause();
    const audio = new Audio(recordedUrl + `?t=${Date.now()}`);
    playbackRef.current = audio;
    audio.play();
    audio.onended = () => { playbackRef.current = null; };
  }, [recordedUrl]);

  const handleStopPlayback = useCallback(() => {
    playbackRef.current?.pause();
    playbackRef.current = null;
  }, []);

  const handleClearRecording = useCallback(() => {
    updateAction(action.id, { customAudioPath: undefined });
    setRecordedUrl(null);
    setRecordedDuration(null);
  }, [action.id, updateAction]);

  return (
    <>
      {/* Audio source toggle */}
      <div className="flex gap-1 mb-2">
        <button
          onClick={() => setAudioMode("tts")}
          className={`flex-1 px-2 py-1 text-[10px] font-medium rounded transition-colors ${
            audioMode === "tts"
              ? "bg-emerald-600 text-white"
              : "bg-slate-800 text-slate-400 hover:bg-slate-700"
          }`}
        >
          Text to Speech
        </button>
        <button
          onClick={() => setAudioMode("record")}
          className={`flex-1 px-2 py-1 text-[10px] font-medium rounded transition-colors ${
            audioMode === "record"
              ? "bg-orange-600 text-white"
              : "bg-slate-800 text-slate-400 hover:bg-slate-700"
          }`}
        >
          Record Voice
        </button>
      </div>

      {audioMode === "record" ? (
        <div className="space-y-2">
          <label className="block text-xs text-slate-400 font-medium">
            Record your narration
          </label>
          <div className="flex gap-2">
            {recording ? (
              <button
                onClick={handleStopRecording}
                className="flex-1 px-3 py-1.5 bg-red-600 hover:bg-red-500 text-white text-xs rounded flex items-center justify-center gap-1.5"
              >
                <span className="w-2 h-2 bg-white rounded-full animate-pulse" />
                Stop
              </button>
            ) : (
              <button
                onClick={handleStartRecording}
                className="flex-1 px-3 py-1.5 bg-orange-600 hover:bg-orange-500 text-white text-xs rounded"
              >
                {recordedUrl ? "Re-record" : "Record"}
              </button>
            )}
          </div>
          {recordedUrl && !recording && (
            <div className="space-y-1">
              <div className="flex gap-2">
                <button onClick={handlePlayRecorded} className="px-3 py-1.5 bg-slate-700 hover:bg-slate-600 text-white text-xs rounded">Play</button>
                <button onClick={handleStopPlayback} className="px-2 py-1.5 bg-slate-700 hover:bg-slate-600 text-white text-xs rounded">Stop</button>
                <button onClick={handleClearRecording} className="px-2 py-1.5 bg-slate-800 hover:bg-red-600/30 text-red-400 text-xs rounded">Remove</button>
              </div>
              <div className="text-[10px] text-orange-400">
                Recorded audio ready{recordedDuration ? ` (${recordedDuration.toFixed(1)}s)` : ""}
              </div>
            </div>
          )}
          {action.customAudioPath && (
            <div className="text-[10px] text-slate-500">
              Custom audio takes priority over TTS
            </div>
          )}
        </div>
      ) : (
        <LanguageAudioSection action={action} />
      )}

      {/* Options: freeze + subtitles */}
      <div className="mt-3 pt-3 border-t border-slate-700/50 space-y-2">
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={action.freeze ?? false}
            onChange={(e) => updateAction(action.id, { freeze: e.target.checked })}
            className="w-3 h-3 rounded border-slate-600 bg-slate-800 text-violet-500 focus:ring-violet-500 focus:ring-offset-0"
          />
          <span className="text-[10px] text-slate-400">Freeze video during narration</span>
        </label>

        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={action.showSubtitles !== false}
            onChange={(e) => updateAction(action.id, { showSubtitles: e.target.checked })}
            className="w-3 h-3 rounded border-slate-600 bg-slate-800 text-violet-500 focus:ring-violet-500 focus:ring-offset-0"
          />
          <span className="text-[10px] text-slate-400">Show subtitles</span>
        </label>

        {action.showSubtitles !== false && (
          <div>
            <label className="block text-[10px] text-slate-500 font-medium mb-1">
              Subtitle Size ({action.subtitleSize ?? 28}px)
            </label>
            <input
              type="range"
              min={16}
              max={64}
              value={action.subtitleSize ?? 28}
              onChange={(e) => updateAction(action.id, { subtitleSize: parseInt(e.target.value) })}
              className="w-full"
            />
            <div className="flex justify-between text-[9px] text-slate-600">
              <span>Small</span>
              <span>Large</span>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
