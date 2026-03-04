import { create } from "zustand";
import type { DemoProject, TimelineAction } from "../types";
import {
  loadProject,
  saveProject,
  createSession,
  loadFilmstrip,
} from "../lib/fileOps";

const api = window.electronAPI;

interface ProjectState {
  // Session
  sessionDir: string | null;
  project: DemoProject | null;
  isDirty: boolean;

  // Timeline state
  selectedActionId: string | null;
  filmstripPaths: string[];
  playheadTime: number;
  drawingZoom: boolean;

  // Capture mode
  captureMode: boolean;
  isRecording: boolean;

  // Production
  isProducing: boolean;
  produceLog: string;

  // Actions
  openSession: (dir: string) => Promise<void>;
  save: () => Promise<void>;
  setPlayhead: (time: number) => void;
  setSelectedAction: (id: string | null) => void;
  setDrawingZoom: (v: boolean) => void;
  addAction: (type: TimelineAction["type"], timestamp: number, endTimestamp?: number) => void;
  updateAction: (id: string, partial: Partial<TimelineAction>) => void;
  deleteAction: (id: string) => void;

  setIsRecording: (v: boolean) => void;

  // Screen capture
  startScreenCapture: (displayId?: string) => Promise<void>;
  stopScreenCapture: () => Promise<void>;

  // Production
  produce: () => Promise<void>;
  preview: () => Promise<void>;
  appendProduceLog: (line: string) => void;
  setIsProducing: (v: boolean) => void;
}

let actionCounter = 0;

export const useProjectStore = create<ProjectState>((set, get) => ({
  sessionDir: null,
  project: null,
  isDirty: false,
  selectedActionId: null,
  filmstripPaths: [],
  playheadTime: 0,
  drawingZoom: false,
  captureMode: false,
  isRecording: false,
  isProducing: false,
  produceLog: "",

  openSession: async (dir: string) => {
    const project = await loadProject(dir);
    const filmstripPaths = await loadFilmstrip(dir);

    // Initialize action counter from existing actions
    if (project.actions.length > 0) {
      const maxNum = Math.max(
        ...project.actions.map((a) => {
          const m = a.id.match(/action-(\d+)/);
          return m ? parseInt(m[1]) : 0;
        }),
      );
      actionCounter = Math.max(actionCounter, maxNum);
    }

    // Cache this as the last opened session
    api.cacheSet("lastSessionDir", dir);

    set({
      sessionDir: dir,
      project,
      isDirty: false,
      selectedActionId: null,
      filmstripPaths,
      playheadTime: 0,
      captureMode: false,
      produceLog: "",
    });
  },

  save: async () => {
    const { sessionDir, project } = get();
    if (!sessionDir || !project) return;
    await saveProject(sessionDir, project);
    set({ isDirty: false });
  },

  setPlayhead: (time) => set({ playheadTime: time }),

  setSelectedAction: (id) => set({ selectedActionId: id, drawingZoom: false }),

  setDrawingZoom: (v) => set({ drawingZoom: v }),

  addAction: (type, timestamp, endTimestamp?) => {
    set((state) => {
      if (!state.project) return state;
      actionCounter++;
      const id = `action-${String(actionCounter).padStart(3, "0")}`;

      const rangeDuration = endTimestamp ? endTimestamp - timestamp : undefined;

      const newAction: TimelineAction = {
        id,
        timestamp,
        type,
        ...(type === "pause" && { resumeAfter: "narration" as const }),
        ...(type === "zoom" && { zoomDuration: 1, zoomHold: 2 }),
        ...(type === "narrate" && { narration: "" }),
        ...(type === "spotlight" && { dimOpacity: 0.7, spotlightDuration: rangeDuration ?? 3 }),
        ...(type === "speed" && { speedFactor: 2, speedEndTimestamp: endTimestamp ?? timestamp + 5 }),
        ...(type === "skip" && { skipEndTimestamp: endTimestamp ?? timestamp + 3 }),
        ...(type === "callout" && { calloutText: "", calloutStyle: "label" as const, calloutDuration: rangeDuration ?? 3 }),
        ...(type === "music" && { musicVolume: 0.5, musicDuckTo: 0.2, musicEndTimestamp: endTimestamp }),
      };

      const actions = [...state.project.actions, newAction].sort(
        (a, b) => a.timestamp - b.timestamp,
      );

      return {
        project: { ...state.project, actions },
        selectedActionId: id,
        isDirty: true,
      };
    });
  },

  updateAction: (id, partial) => {
    set((state) => {
      if (!state.project) return state;
      const actions = state.project.actions.map((a) =>
        a.id === id ? { ...a, ...partial } : a,
      );
      // Re-sort if timestamp changed
      if (partial.timestamp !== undefined) {
        actions.sort((a, b) => a.timestamp - b.timestamp);
      }
      return {
        project: { ...state.project, actions },
        isDirty: true,
      };
    });
  },

  deleteAction: (id) => {
    set((state) => {
      if (!state.project) return state;
      const actions = state.project.actions.filter((a) => a.id !== id);
      return {
        project: { ...state.project, actions },
        selectedActionId:
          state.selectedActionId === id ? null : state.selectedActionId,
        isDirty: true,
      };
    });
  },

  setIsRecording: (v) => set({ isRecording: v }),

  // ---- Screen Capture ----

  startScreenCapture: async (displayId?: string) => {
    const sessionDir = await createSession("screen-recording");
    if (!sessionDir) return; // user cancelled save dialog

    // Get display info for the selected monitor
    let opts: { displayId?: string } = {};
    if (displayId) {
      opts.displayId = displayId;
    }

    await api.startScreenRecording(sessionDir, opts);

    const project: DemoProject = {
      title: "Screen Recording",
      baseUrl: "screen://",
      recordingPath: `${sessionDir}/recordings/recording.mp4`,
      recordingDuration: 0,
      viewport: { width: 1920, height: 1080 },
      output: { width: 1920, height: 1080, fps: 30, format: "mp4" },
      tts: {
        provider: "kokoro-direct",
        kokoroEndpoint: "http://localhost:8880/v1/audio/speech",
        voiceEn: "af_heart",
        voiceHi: "hf_alpha",
        speed: 1,
      },
      actions: [],
    };

    set({
      sessionDir,
      project,
      isDirty: false,
      captureMode: true,
      isRecording: true,
      selectedActionId: null,
      filmstripPaths: [],
      playheadTime: 0,
      produceLog: "",
    });
  },

  stopScreenCapture: async () => {
    const { sessionDir } = get();
    if (!sessionDir) return;

    try {
      const result = await api.stopScreenRecording();
      console.log("[stopScreenCapture] Recording result:", result);

      // Generate filmstrip
      await api.generateFilmstrip(sessionDir);

      // Get actual video duration
      let duration = result.duration;
      try {
        duration = await api.getVideoDuration(result.videoPath);
      } catch { /* use elapsed */ }

      // Load filmstrip
      const filmstripPaths = await loadFilmstrip(sessionDir);

      set((state) => {
        if (!state.project) return state;
        const project = {
          ...state.project,
          recordingPath: result.videoPath,
          recordingDuration: duration,
        };
        return {
          project,
          captureMode: false,
          isRecording: false,
          filmstripPaths,
        };
      });

      // Save the project
      const { project } = get();
      if (project) {
        await saveProject(sessionDir, project);
      }
    } catch (err) {
      console.error("Stop screen capture failed:", err);
      set({ captureMode: false, isRecording: false });
    }
  },

  // ---- Production ----

  produce: async () => {
    const { sessionDir, project } = get();
    if (!sessionDir || !project) return;

    // Save first
    await saveProject(sessionDir, project);

    set({ isProducing: true, produceLog: "Starting production...\n" });

    try {
      const finalPath = await api.produceTimelineVideo(sessionDir);

      set((s) => ({
        produceLog: s.produceLog + `\nDone! Output: ${finalPath}\n`,
        isProducing: false,
      }));
    } catch (err) {
      set((s) => ({
        produceLog: s.produceLog + `\nError: ${err}\n`,
        isProducing: false,
      }));
    }
  },

  preview: async () => {
    const { sessionDir, project } = get();
    if (!sessionDir || !project) return;

    // Save first
    await saveProject(sessionDir, project);

    set({ isProducing: true, produceLog: "Starting preview...\n" });

    try {
      const finalPath = await api.previewVideo(sessionDir);
      set((s) => ({
        produceLog: s.produceLog + `\nPreview opened: ${finalPath}\n`,
        isProducing: false,
      }));
    } catch (err) {
      set((s) => ({
        produceLog: s.produceLog + `\nPreview error: ${err}\n`,
        isProducing: false,
      }));
    }
  },

  appendProduceLog: (line) =>
    set((s) => ({ produceLog: s.produceLog + line + "\n" })),

  setIsProducing: (v) => set({ isProducing: v }),
}));
