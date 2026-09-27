/** Sessions: open (timeline or job, via session:probe), save, close, job language switch,
 *  "Detach as video edit", and watching the files a CLI run may rewrite (D31). */
import type { StateCreator } from "zustand";
import type { DemoProject, SessionInfo } from "../../types";
import type { SessionProbe } from "../../types/narascreen-ipc";
import { loadFilmstrip } from "../../lib/fileOps";
import { migrateProjectWithReport, newProject } from "../../lib/migrateProject";
import { noteOpened, noteSaved, recentFromProject } from "../../lib/recentProjects";
import { api, errMsg, hasBridge, probeSession, probeVideo, readJson, setWindowTitle, watchFiles } from "./bridge";
import { applyScriptEntries, mergeCompiledLanguages, scriptExtras, voiceList } from "./detach";
import { maxActionNumber } from "./effects";
import { historyState, selectionState } from "./edit";
import { EMPTY_SELECTION, pruneSelection } from "./selection";
import type { ProjectState } from "./types";

type SessionSlice = Pick<ProjectState, "openSession" | "closeSession" | "save" | "setViewLang" | "detachJob">;

const PROJECT_FILE = "demo-project.json";
/** What we last wrote, so our own saves don't look like outside changes. */
let lastWritten: { path: string; text: string } | null = null;
let unwatch: (() => void) | null = null;

/** Fresh-session state (also used by capture/import). */
export function sessionReset(): Partial<ProjectState> {
  return {
    isDirty: false,
    ...historyState([], []),
    ...selectionState(EMPTY_SELECTION),
    _coalesce: null,
    playheadTime: 0,
    isPlaying: false,
    captureMode: false,
    produceLog: "",
    drawingZoom: false,
    generating: {},
  };
}

/** Read + migrate a project file; the recording is probed for its real size (D29). */
export async function loadProjectFile(path: string): Promise<{ project: DemoProject; warnings: string[] }> {
  const raw = await readJson(path);
  const rec = (raw as { recordingPath?: unknown })?.recordingPath;
  const probe = typeof rec === "string" ? await probeVideo(rec) : null;
  const rep = migrateProjectWithReport(raw, probe ? { recordingSize: { width: probe.width, height: probe.height }, recordingDuration: probe.durationSec } : {});
  return { project: rep.project, warnings: rep.warnings };
}

export async function writeProjectFile(dir: string, project: DemoProject): Promise<void> {
  const path = `${dir}/${PROJECT_FILE}`;
  const text = JSON.stringify({ ...project, projectVersion: 2 }, null, 2);
  lastWritten = { path, text };
  await api().writeTextFile(path, text);
}

const pickViewLang = (langs: string[], prefer?: string) => (prefer && langs.includes(prefer) ? prefer : langs.includes("en") ? "en" : langs[0]);

async function loadJobView(dir: string, probe: SessionProbe, lang: string | undefined): Promise<DemoProject> {
  const files = probe.job?.projectFiles ?? {};
  const file = (lang && files[lang]) || (probe.hasProject ? `${dir}/${PROJECT_FILE}` : undefined);
  if (file) return (await loadProjectFile(file)).project;
  // Recorded but never produced: show the recording without effects.
  let job: { scope?: string; record?: { recordingPath?: string; durationSec?: number } } = {};
  try {
    job = (await readJson(`${dir}/job.json`)) as typeof job;
  } catch { /* keep defaults */ }
  const recordingPath = job.record?.recordingPath ?? `${dir}/recordings/recording.mp4`;
  const size = await probeVideo(recordingPath);
  return newProject({ title: job.scope ?? dir.split(/[\\/]/).pop() ?? "Job", baseUrl: "", recordingPath, recordingDuration: job.record?.durationSec ?? size?.durationSec, size: size ?? undefined });
}

export const createSessionSlice: StateCreator<ProjectState, [], [], SessionSlice> = (set, get) => {
  const watch = (dir: string, session: SessionInfo, probe?: SessionProbe) => startWatching(get, set, dir, session, probe);

  const openFrom = async (dir: string, preferLang?: string) => {
    const probe = await probeSession(dir);
    let project: DemoProject;
    let session: SessionInfo;
    if (probe.kind === "job") {
      const langs = probe.job?.producedLangs ?? [];
      const viewLang = pickViewLang(langs, preferLang);
      project = await loadJobView(dir, probe, viewLang);
      session = { kind: "job", scriptPath: probe.job?.scriptPath ?? `${dir}/script.json`, viewLang, langs, readOnly: true };
    } else if (probe.hasProject) {
      const r = await loadProjectFile(`${dir}/${PROJECT_FILE}`);
      project = r.project;
      if (r.warnings.length) alert(r.warnings.join("\n"));
      session = { kind: "timeline", readOnly: false };
    } else {
      throw new Error(`${dir} is not a NaraScreen project: it has no ${PROJECT_FILE} or job.json.`);
    }
    return { probe, project, session };
  };

  return {
    openSession: async (dir) => {
      set({ isLoading: true, loadingMessage: "Opening project…" });
      try {
        const { probe, project, session } = await openFrom(dir);
        const filmstripPaths = await loadFilmstrip(dir);
        set({
          ...sessionReset(),
          sessionDir: dir,
          project,
          session,
          filmstripPaths,
          _idCounter: maxActionNumber(project.actions),
          isLoading: false,
          loadingMessage: "",
        });
        void api().cacheSet("lastSessionDir", dir);
        void noteOpened(recentFromProject(dir, project, { thumb: filmstripPaths[0] ?? null, kind: session.kind }));
        void setWindowTitle(`${project.title} — NaraScreen`);
        watch(dir, session, probe);
      } catch (err) {
        set({ isLoading: false, loadingMessage: "" });
        throw err;
      }
    },

    closeSession: async () => {
      const s = get();
      if (s.isDirty && !s.session?.readOnly) {
        try {
          await s.save();
        } catch (err) {
          if (!confirm(`Saving failed: ${errMsg(err)}\n\nClose the project anyway?`)) return;
        }
      }
      stopWatching();
      set({ ...sessionReset(), sessionDir: null, project: null, session: null, filmstripPaths: [], _idCounter: 0 });
      void setWindowTitle("NaraScreen");
    },

    save: async () => {
      const { sessionDir, project, session } = get();
      if (!sessionDir || !project || session?.readOnly) return;
      await writeProjectFile(sessionDir, project);
      if (get().project === project) set({ isDirty: false });
      void noteSaved(recentFromProject(sessionDir, project));
    },

    setViewLang: async (lang) => {
      const s = get();
      if (s.session?.kind !== "job" || !s.sessionDir || s.session.viewLang === lang) return;
      const dir = s.sessionDir;
      const probe = await probeSession(dir);
      const project = await loadJobView(dir, probe, lang);
      const session = { ...s.session, viewLang: lang };
      set({ project, session, ...keepSelection(s, project) });
      watch(dir, session, probe);
    },

    detachJob: async () => {
      const s = get();
      if (s.session?.kind !== "job" || !s.sessionDir || !s.project) throw new Error("Only a job can be detached.");
      const jobDir = s.sessionDir.replace(/[\\/]+$/, "");
      set({ isLoading: true, loadingMessage: "Creating a video edit…" });
      try {
        const probe = await probeSession(jobDir);
        const viewLang = s.session.viewLang ?? "en";
        const byLang: Record<string, DemoProject> = {};
        for (const [lang, file] of Object.entries(probe.job?.projectFiles ?? {})) byLang[lang] = (await loadProjectFile(file)).project;
        if (!byLang[viewLang]) byLang[viewLang] = s.project;
        let project = mergeCompiledLanguages(byLang, viewLang);

        let script: unknown = null;
        const scriptPath = s.session.scriptPath;
        if (scriptPath) {
          try {
            script = hasBridge("script") ? (await api().script.read(scriptPath)).json : await readJson(scriptPath);
          } catch { /* the compiled projects are enough */ }
        }
        const { voices, ...extras } = scriptExtras(script as never, scriptPath ?? "");
        project = { ...applyScriptEntries(project, script as never), ...extras };
        if (voices) project.tts = { ...project.tts, voices: Object.fromEntries(Object.entries(voices).map(([l, v]) => [l, voiceList(l, v)])) };

        let dir = `${jobDir}-edit`;
        for (let i = 2; await api().exists(dir); i++) dir = `${jobDir}-edit-${i}`;
        await api().mkdir(`${dir}/recordings`, { recursive: true });
        await api().mkdir(`${dir}/thumbnails`, { recursive: true });
        let recordingPath = project.recordingPath;
        if (hasBridge("video")) {
          set({ loadingMessage: "Copying the recording…" });
          recordingPath = (await api().video.importFile({ src: project.recordingPath, sessionDir: dir, mode: "copy" })).recordingPath;
        }
        const detached: DemoProject = {
          ...project,
          recordingPath,
          actions: project.actions.map((a) => {
            const copy = { ...a };
            delete copy.source; // no longer linked to the script
            return copy;
          }),
          projectVersion: 2,
        };
        delete detached.origin;
        try {
          await api().generateFilmstrip(dir);
        } catch { /* thumbnails are optional */ }
        await writeProjectFile(dir, detached);
        set({ isLoading: false, loadingMessage: "" });
        await get().openSession(dir);
        return dir;
      } catch (err) {
        set({ isLoading: false, loadingMessage: "" });
        throw err;
      }
    },
  };
};

type Get = () => ProjectState;
type Set = (p: Partial<ProjectState>) => void;

/** Watch the files the open session shows (D31): a CLI run rewriting a job refreshes its
 *  read-only view; an outside change to a timeline project reloads it (asking first when there
 *  are unsaved edits). Our own saves are recognised and ignored. */
export function startWatching(get: Get, set: Set, dir: string, session: SessionInfo, probe?: SessionProbe): void {
  unwatch?.();
  const viewFile = session.viewLang ? probe?.job?.projectFiles[session.viewLang] : undefined;
  const paths = session.kind === "job" ? [`${dir}/job.json`, ...(viewFile ? [viewFile] : [])] : [`${dir}/${PROJECT_FILE}`];
  unwatch = watchFiles(paths, (changed) => void onExternalChange(get, set, dir, changed));
}

const keepSelection = (s: ProjectState, project: DemoProject) =>
  selectionState(pruneSelection({ selectedIds: s.selectedIds, primaryId: s.primaryId }, (id) => project.actions.some((a) => a.id === id)));

async function onExternalChange(get: Get, set: Set, dir: string, changed: string): Promise<void> {
  const s = get();
  if (s.sessionDir !== dir || !s.session) return;
  if (s.session.kind === "job") {
    try {
      const probe = await probeSession(dir);
      const langs = probe.job?.producedLangs ?? s.session.langs ?? [];
      const project = await loadJobView(dir, probe, pickViewLang(langs, s.session.viewLang));
      set({ project, session: { ...s.session, langs }, ...keepSelection(get(), project) });
    } catch { /* mid-write: the next event reloads */ }
    return;
  }
  try {
    const text = await api().readTextFile(changed);
    if (lastWritten?.path === changed && lastWritten.text === text) return;
    if (get().isDirty && !confirm(`${PROJECT_FILE} was changed outside NaraScreen.\n\nReload it? Your unsaved changes will be lost.`)) return;
    const { project } = migrateProjectWithReport(JSON.parse(text), { recordingSize: get().project?.viewport });
    set({ project, isDirty: false, ...historyState([], []), ...keepSelection(get(), project) });
  } catch { /* partial write: the next event reloads */ }
}

/** Stop watching (closing the session). */
export function stopWatching(): void {
  unwatch?.();
  unwatch = null;
}
