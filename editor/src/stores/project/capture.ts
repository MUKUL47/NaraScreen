/** Screen capture, video import (D9: both pickers before the spinner; D30: copy/normalise in
 *  main via video.importFile), and the deprecated in-process produce shims. */
import type { StateCreator } from "zustand";
import type { DemoProject } from "../../types";
import { createSession, defaultRecordingName, defaultRecordingParentDir, loadFilmstrip } from "../../lib/fileOps";
import { newProject } from "../../lib/migrateProject";
import { noteOpened, recentFromProject } from "../../lib/recentProjects";
import { api, errMsg, hasBridge, probeVideo } from "./bridge";
import { sessionReset, startWatching, writeProjectFile } from "./session";
import type { ProjectState } from "./types";

type CaptureSlice = Pick<
  ProjectState,
  | "setIsRecording" | "startScreenCapture" | "stopScreenCapture" | "discardScreenCapture" | "importVideo"
  | "produce" | "cancelProduce" | "appendProduceLog" | "setIsProducing"
>;

const TIMELINE = { kind: "timeline" as const, readOnly: false };

export const createCaptureSlice: StateCreator<ProjectState, [], [], CaptureSlice> = (set, get) => {
  /** Open a session this slice just created. */
  const opened = async (dir: string, project: DemoProject) => {
    const filmstripPaths = await loadFilmstrip(dir);
    set({ ...sessionReset(), sessionDir: dir, project, session: TIMELINE, filmstripPaths, _idCounter: 0 });
    void api().cacheSet("lastSessionDir", dir);
    void noteOpened(recentFromProject(dir, project, { thumb: filmstripPaths[0] ?? null, kind: "timeline" }));
    startWatching(get, set, dir, TIMELINE);
  };

  return {
    setIsRecording: (v) => set({ isRecording: v }),

    startScreenCapture: async (displayId, options) => {
      const sessionDir = await createSession("screen-recording", options);
      if (!sessionDir) return; // cancelled
      await api().startScreenRecording(sessionDir, displayId ? { displayId } : {});
      const project = newProject({ title: options?.name?.trim() || "Screen Recording", baseUrl: "screen://", recordingPath: `${sessionDir}/recordings/recording.mp4` });
      set({ ...sessionReset(), sessionDir, project, session: TIMELINE, filmstripPaths: [], captureMode: true, isRecording: true });
    },

    stopScreenCapture: async () => {
      const { sessionDir } = get();
      if (!sessionDir) return;
      set({ isLoading: true, loadingMessage: "Processing recording…" });
      try {
        const result = await api().stopScreenRecording();
        try {
          await api().generateFilmstrip(sessionDir);
        } catch (err) {
          alert(`Filmstrip generation failed — timeline thumbnails will be missing.\n\n${errMsg(err)}`);
        }
        const probe = await probeVideo(result.videoPath);
        let duration = probe?.durationSec ?? result.duration;
        if (!probe) {
          try {
            duration = await api().getVideoDuration(result.videoPath);
          } catch { /* keep the elapsed time */ }
        }
        const prev = get().project;
        if (!prev) return;
        const size = probe ? { width: probe.width, height: probe.height } : prev.viewport;
        const project: DemoProject = {
          ...prev,
          recordingPath: result.videoPath,
          recordingDuration: duration,
          viewport: size,
          output: { ...prev.output, ...size },
        };
        await writeProjectFile(sessionDir, project);
        await opened(sessionDir, project);
      } catch (err) {
        alert(`Failed to finalize recording: ${errMsg(err)}`);
        set({ ...sessionReset(), sessionDir: null, project: null, session: null, filmstripPaths: [], isRecording: false });
      } finally {
        set({ captureMode: false, isRecording: false, isLoading: false, loadingMessage: "" });
      }
    },

    discardScreenCapture: async () => {
      const { sessionDir } = get();
      if (!sessionDir) return;
      set({ isLoading: true, loadingMessage: "Discarding recording…" });
      try {
        await api().stopScreenRecording();
      } catch { /* stop ffmpeg first; continue either way */ }
      try {
        await api().trashItem(sessionDir);
      } catch (err) {
        alert(`Failed to discard the recording folder. You may want to delete it manually.\n\n${sessionDir}\n\n${errMsg(err)}`);
      }
      try {
        if ((await api().cacheGet("lastSessionDir")) === sessionDir) await api().cacheSet("lastSessionDir", null);
      } catch { /* cache best-effort */ }
      set({ ...sessionReset(), sessionDir: null, project: null, session: null, filmstripPaths: [], isRecording: false, isLoading: false, loadingMessage: "" });
    },

    importVideo: async () => {
      // Both pickers first: cancelling either leaves no spinner behind (D9).
      const videoPath = await api().openVideoFile();
      if (!videoPath) return;
      const chosenDir = await api().pickSaveDirectory(await defaultRecordingParentDir());
      if (!chosenDir) return;
      set({ isLoading: true, loadingMessage: "Importing video…", importProgress: 0 });
      let unsub: (() => void) | undefined;
      try {
        const sessionDir = `${chosenDir}/${defaultRecordingName()}`;
        await api().mkdir(`${sessionDir}/recordings`, { recursive: true });
        await api().mkdir(`${sessionDir}/thumbnails`, { recursive: true });
        let recordingPath = `${sessionDir}/recordings/recording.mp4`;
        let size: { width: number; height: number } | undefined;
        let duration = 0;
        if (hasBridge("video")) {
          // Copied (or normalised to H.264 / 30 fps) in main, never through renderer memory (D30).
          unsub = api().video.onImportProgress((p) => {
            if (p.sessionDir === sessionDir) set({ importProgress: p.fraction, loadingMessage: `Importing video… ${Math.round(p.fraction * 100)}%` });
          });
          const r = await api().video.importFile({ src: videoPath, sessionDir });
          ({ recordingPath, durationSec: duration } = r);
          size = { width: r.width, height: r.height };
        } else {
          const buffer = await (await fetch(`file://${videoPath}`)).arrayBuffer();
          await api().writeBinaryFile(recordingPath, buffer);
          const probe = await probeVideo(recordingPath);
          if (probe) [size, duration] = [{ width: probe.width, height: probe.height }, probe.durationSec];
          else duration = await api().getVideoDuration(recordingPath).catch(() => 0);
        }
        set({ loadingMessage: "Generating thumbnails…" });
        try {
          await api().generateFilmstrip(sessionDir);
        } catch (err) {
          alert(`Filmstrip generation failed — timeline thumbnails will be missing.\n\n${errMsg(err)}`);
        }
        const title = videoPath.split(/[\\/]/).pop()?.replace(/\.[^.]+$/, "") || "Imported Video";
        const project = newProject({ title, baseUrl: "import://", recordingPath, recordingDuration: duration, size });
        await writeProjectFile(sessionDir, project);
        await opened(sessionDir, project);
      } catch (err) {
        alert(`Import failed: ${errMsg(err)}`);
      } finally {
        unsub?.();
        set({ isLoading: false, loadingMessage: "", importProgress: null });
      }
    },

    // ─── deprecated: the legacy in-process renderer (export goes through the CLI now) ───
    produce: async (selectedActionIds, resolution, crf, trim) => {
      const { sessionDir, project } = get();
      if (!sessionDir || !project || get().session?.readOnly) return;
      await get().save();
      set({ isProducing: true, isLoading: true, loadingMessage: "Producing video…", produceLog: "Starting production...\n" });
      try {
        const finalPath = await api().produceTimelineVideo(sessionDir, undefined, selectedActionIds, resolution, crf, trim ?? undefined);
        set((s) => ({ produceLog: `${s.produceLog}\nDone! Output: ${finalPath}\n` }));
      } catch (err) {
        set((s) => ({ produceLog: `${s.produceLog}\nError: ${errMsg(err)}\n` }));
      } finally {
        set({ isProducing: false, isLoading: false, loadingMessage: "" });
      }
    },
    cancelProduce: async () => {
      try {
        await api().cancelProduce();
      } catch { /* not supported */ }
      set((s) => ({ produceLog: `${s.produceLog}\nProduction cancelled.\n`, isProducing: false, isLoading: false, loadingMessage: "" }));
    },
    appendProduceLog: (line) => set((s) => ({ produceLog: `${s.produceLog}${line}\n` })),
    setIsProducing: (v) => set({ isProducing: v }),
  };
};
