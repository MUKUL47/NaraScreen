// ─── useRunsStore: CLI runs started from the desktop ─────────────────
//
// One entry per `window.electronAPI.cli.run(...)`: its stage/step progress, log
// lines (all, and per "[lang]"), warnings and the end envelope. The store
// subscribes to cli:event / cli:end once, and re-attaches to runs that are
// still going after a renderer reload (cli.list()).
//
//   const runId = await useRunsStore.getState().start({ command: "make", arg, flags, tag: "export" });
//   const run = useRunsStore((s) => s.activeFor("export"));

import { create } from "zustand";
import type {
  CliCommand,
  CliEndMsg,
  CliEventMsg,
  CliRunHandle,
  CliRunRequest,
  NaraEvent,
  Stage,
} from "../types/narascreen-ipc";

export type RunStatus = "running" | "ok" | "failed" | "cancelled";

export interface RunStep {
  index: number;
  total: number;
  id: string;
  message: string;
}

export interface RunState {
  handle: CliRunHandle;
  command: CliCommand;
  tag?: string;
  /** The request without its env values (those never enter the store). */
  request?: Omit<CliRunRequest, "env">;
  /** Latest stage, and every stage seen in order (drives a stepper). */
  stage?: Stage;
  stageMessage?: string;
  stages: Stage[];
  /** Latest stage per language, when languages render in parallel. */
  langStages: Record<string, Stage>;
  step?: RunStep;
  /** Every log/stage/warning line, oldest first (capped at MAX_LINES). */
  log: string[];
  /** Lines by language ("[en] …" prefix or data.lang); capped per language. */
  langs: Record<string, string[]>;
  warnings: string[];
  /** Recent raw events (capped at MAX_EVENTS). */
  events: NaraEvent[];
  status: RunStatus;
  end?: CliEndMsg;
  startedAtMs: number;
  endedAtMs?: number;
}

interface RunsStore {
  runs: Record<string, RunState>;
  /** Start a CLI run; resolves with its runId once the process is up. */
  start(req: CliRunRequest): Promise<string>;
  /** Stop a run (SIGTERM, SIGKILL after 5 s). Its end arrives as usual, with cancelled: true. */
  cancel(runId: string): Promise<boolean>;
  /** The running run with this tag, if any. */
  activeFor(tag: string): RunState | undefined;
  /** The newest run with this tag (running or finished). */
  latestFor(tag: string): RunState | undefined;
  /** Forget a finished run. */
  dismiss(runId: string): void;
}

export const MAX_LINES = 2000;
const MAX_LANG_LINES = 1000;
const MAX_EVENTS = 500;
const LANG_PREFIX = /^\[([a-z]{2,3}(?:-[A-Za-z0-9]+)?)\]\s?/;

const api = () => (typeof window !== "undefined" ? window.electronAPI : undefined);

function push<T>(list: T[], item: T, cap: number): T[] {
  const next = list.length >= cap ? list.slice(list.length - cap + 1) : list.slice();
  next.push(item);
  return next;
}

function newRun(handle: CliRunHandle, request?: CliRunRequest): RunState {
  let req: Omit<CliRunRequest, "env"> | undefined;
  if (request) {
    const copy: CliRunRequest = { ...request };
    delete copy.env;
    req = copy;
  }
  return {
    handle,
    command: handle.command,
    tag: handle.tag,
    request: req,
    stages: [],
    langStages: {},
    log: [],
    langs: {},
    warnings: [],
    events: [],
    status: "running",
    startedAtMs: Date.parse(handle.startedAt) || Date.now(),
  };
}

function applyEvent(run: RunState, ev: NaraEvent): RunState {
  const next: RunState = { ...run, events: push(run.events, ev, MAX_EVENTS) };
  const dataLang = typeof ev.data?.lang === "string" ? (ev.data.lang as string) : undefined;
  const m = LANG_PREFIX.exec(ev.message);
  const lang = dataLang ?? m?.[1];
  const text = ev.type === "stage" ? `▶ ${ev.message}` : ev.type === "warning" ? `⚠ ${ev.message}` : ev.type === "step" ? `• ${ev.message}` : ev.message;
  next.log = push(run.log, text, MAX_LINES);
  if (lang) next.langs = { ...run.langs, [lang]: push(run.langs[lang] ?? [], m ? text.replace(LANG_PREFIX, "") : text, MAX_LANG_LINES) };
  if (ev.type === "stage" && ev.stage) {
    next.stage = ev.stage;
    next.stageMessage = ev.message;
    if (!run.stages.includes(ev.stage)) next.stages = [...run.stages, ev.stage];
    if (lang) next.langStages = { ...run.langStages, [lang]: ev.stage };
  } else if (ev.type === "step") {
    const d = ev.data ?? {};
    next.step = {
      index: typeof d.index === "number" ? d.index : (run.step?.index ?? 0) + 1,
      total: typeof d.total === "number" ? d.total : (run.step?.total ?? 0),
      id: typeof d.id === "string" ? d.id : "",
      message: ev.message,
    };
  } else if (ev.type === "warning") {
    next.warnings = [...run.warnings, ev.message];
  }
  return next;
}

function applyEnd(run: RunState, end: CliEndMsg): RunState {
  const status: RunStatus = end.cancelled ? "cancelled" : end.envelope?.ok && end.exitCode === 0 ? "ok" : "failed";
  // The envelope's warnings are the complete, de-duplicated list.
  const warnings = end.envelope?.warnings?.length ? [...new Set([...run.warnings, ...end.envelope.warnings])] : run.warnings;
  return { ...run, status, end, warnings, endedAtMs: Date.now() };
}

/** Events that arrive before cli.run resolves (or for runs found by cli.list) wait here. */
const pending = new Map<string, { events: NaraEvent[]; end?: CliEndMsg }>();
let subscribed = false;

export const useRunsStore = create<RunsStore>((set, get) => {
  const onEvent = (m: CliEventMsg) => {
    const run = get().runs[m.runId];
    if (!run) {
      const p = pending.get(m.runId) ?? { events: [] };
      if (p.events.length < MAX_EVENTS) p.events.push(m.event);
      pending.set(m.runId, p);
      return;
    }
    set((s) => ({ runs: { ...s.runs, [m.runId]: applyEvent(s.runs[m.runId], m.event) } }));
  };
  const onEnd = (m: CliEndMsg) => {
    const run = get().runs[m.runId];
    if (!run) {
      const p = pending.get(m.runId) ?? { events: [] };
      p.end = m;
      pending.set(m.runId, p);
      return;
    }
    set((s) => ({ runs: { ...s.runs, [m.runId]: applyEnd(s.runs[m.runId], m) } }));
  };
  /** Add a run, replaying whatever arrived for it before we knew it. */
  const adopt = (handle: CliRunHandle, request?: CliRunRequest) => {
    let run = newRun(handle, request);
    const p = pending.get(handle.runId);
    if (p) {
      pending.delete(handle.runId);
      for (const ev of p.events) run = applyEvent(run, ev);
      if (p.end) run = applyEnd(run, p.end);
    }
    set((s) => ({ runs: { ...s.runs, [handle.runId]: run } }));
  };

  const bridge = api();
  if (bridge?.cli && !subscribed) {
    subscribed = true;
    bridge.cli.onEvent(onEvent);
    bridge.cli.onEnd(onEnd);
    // After a renderer reload: pick up runs that are still going.
    void bridge.cli
      .list()
      .then((handles) => {
        for (const h of handles) if (!get().runs[h.runId]) adopt(h);
      })
      .catch(() => {});
  }

  return {
    runs: {},

    async start(req) {
      const b = api();
      if (!b?.cli) throw new Error("INTERNAL: the CLI bridge is not available (not running in the desktop app)");
      const handle = await b.cli.run(req);
      adopt(handle, req);
      return handle.runId;
    },

    async cancel(runId) {
      const b = api();
      if (!b?.cli) return false;
      const r = await b.cli.cancel(runId);
      return r.ok;
    },

    activeFor(tag) {
      return Object.values(get().runs).find((r) => r.tag === tag && r.status === "running");
    },

    latestFor(tag) {
      let best: RunState | undefined;
      for (const r of Object.values(get().runs)) if (r.tag === tag && (!best || r.startedAtMs >= best.startedAtMs)) best = r;
      return best;
    },

    dismiss(runId) {
      const run = get().runs[runId];
      if (!run || run.status === "running") return;
      set((s) => {
        const runs = { ...s.runs };
        delete runs[runId];
        return { runs };
      });
    },
  };
});
