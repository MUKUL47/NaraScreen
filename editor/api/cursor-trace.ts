// ─── cursor-trace: the recording's interactions → project.cursor / project.camera ──
//
// PURE. The runner stamps every act on an element with a `pointer` (kind, when
// it began, the element's box). This turns the trace into the two optional
// project fields the renderer's final pass reads (electron/fx-motion.ts):
//   cursor: the planned pointer path (fx-cursor.ts), when the script shows it;
//   camera: each step's window + follow setting, and the act targets.
// Neither is part of the structure hash: turning them on/off never re-records.

import { planCursorPath } from "../electron/fx-cursor";
import type { ProjectCamera, ProjectCursor } from "../electron/fx-motion";
import { RECT_ACTS } from "./schema";
import type { DemoScript, TraceEntry } from "./types";

export function motionProject(
  script: DemoScript,
  trace: TraceEntry[],
  recordingSec: number,
  warnings: string[] = [],
): { cursor?: ProjectCursor; camera?: ProjectCamera } {
  const out: { cursor?: ProjectCursor; camera?: ProjectCamera } = {};
  const acts = trace.filter((e) => e.kind === "act" && e.pointer);
  const frame = script.viewport;

  // ── cursor (browser recordings only: a video-source script has no pointer data)
  const show = script.cursor?.show ?? (!script.source && !script.plugins?.flutter);
  if (show && !script.source) {
    if (!acts.length && trace.some((e) => e.kind === "act" && e.act && RECT_ACTS.includes(e.act) && e.act !== "swipe")) {
      warnings.push("cursor: this job was recorded before NaraScreen tracked the pointer, so none is drawn. Re-record (`make --force`) to show it.");
    }
    const track = planCursorPath(
      acts.map((e) => ({ kind: e.pointer!.kind, rect: e.pointer!.rect, t0: e.pointer!.t0, t1: Math.max(e.pointer!.t0, e.end ?? e.t) })),
      frame,
    );
    if (track) {
      const { size, clickEffect, color } = script.cursor ?? {};
      out.cursor = { track, ...(size != null ? { size } : {}), ...(clickEffect != null ? { clickEffect } : {}), ...(color ? { color } : {}) };
    }
  }

  // ── follow camera
  const steps = script.steps.map((st, k) => {
    const mine = trace.filter((e) => e.beat === st.id);
    const next = script.steps.slice(k + 1).map((n) => trace.filter((e) => e.beat === n.id)).find((x) => x.length);
    const start = mine.length ? Math.min(...mine.map((e) => e.start ?? e.t)) : 0;
    const end = next ? Math.min(...next.map((e) => e.start ?? e.t)) : recordingSec;
    return {
      id: st.id,
      start,
      end,
      follow: st.camera?.follow ?? script.camera?.follow ?? false,
      ...(st.camera?.scale != null ? { scale: st.camera.scale } : {}),
    };
  });
  if (steps.some((s) => s.follow)) {
    const c = script.camera ?? {};
    out.camera = {
      ...(c.scale != null ? { scale: c.scale } : {}),
      ...(c.ease != null ? { ease: c.ease } : {}),
      ...(c.hold != null ? { hold: c.hold } : {}),
      steps,
      // waitFor is a gate (the page is ready), not something the viewer should look at.
      targets: acts
        .filter((e) => e.pointer!.kind !== "wait")
        .map((e) => ({ t0: e.pointer!.t0, t1: Math.max(e.pointer!.t0, e.end ?? e.t), rect: e.pointer!.rect, step: e.beat })),
    };
  }
  return out;
}
