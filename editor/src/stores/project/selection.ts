/** Multi-select model (design brief §8.5): selectedIds + primaryId. Pure. */

export interface SelectOptions {
  /** Ctrl/Cmd-click: toggle the ids in or out of the selection. */
  additive?: boolean;
  /** Shift-click: select everything between the primary and the id (in `order`). */
  range?: boolean;
  /** The order a range runs through (e.g. the clicked lane's clip ids); default all actions by time. */
  order?: string[];
}

export interface Selection {
  selectedIds: string[];
  primaryId: string | null;
}

export const EMPTY_SELECTION: Selection = { selectedIds: [], primaryId: null };

export function applySelect(cur: Selection, ids: string[] | string | null, opts: SelectOptions, allIds: string[]): Selection {
  const list = ids == null ? [] : Array.isArray(ids) ? ids : [ids];
  if (!list.length) return opts.additive || opts.range ? cur : EMPTY_SELECTION;
  const last = list[list.length - 1];
  if (opts.range) {
    const order = opts.order?.length ? opts.order : allIds;
    const anchor = cur.primaryId && order.includes(cur.primaryId) ? cur.primaryId : null;
    const a = anchor ? order.indexOf(anchor) : -1;
    const b = order.indexOf(last);
    const span = a >= 0 && b >= 0 ? order.slice(Math.min(a, b), Math.max(a, b) + 1) : [last];
    const base = opts.additive ? cur.selectedIds : anchor ? [anchor] : [];
    return { selectedIds: dedupe([...base, ...span]), primaryId: anchor ?? last };
  }
  if (opts.additive) {
    let sel = [...cur.selectedIds];
    let primary = cur.primaryId;
    for (const id of list) {
      if (sel.includes(id)) {
        sel = sel.filter((x) => x !== id);
        if (primary === id) primary = sel[sel.length - 1] ?? null;
      } else {
        sel.push(id);
        primary = id;
      }
    }
    return { selectedIds: sel, primaryId: primary };
  }
  return { selectedIds: dedupe(list), primaryId: last };
}

/** Keep only ids that still exist (after delete / undo / reload). */
export function pruneSelection(cur: Selection, exists: (id: string) => boolean): Selection {
  const selectedIds = cur.selectedIds.filter(exists);
  if (selectedIds.length === cur.selectedIds.length && (cur.primaryId == null || exists(cur.primaryId))) return cur;
  const primaryId = cur.primaryId && exists(cur.primaryId) ? cur.primaryId : selectedIds[selectedIds.length - 1] ?? null;
  return { selectedIds, primaryId };
}

const dedupe = (xs: string[]) => [...new Set(xs)];
