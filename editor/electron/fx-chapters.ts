// ─── fx-chapters: MP4 chapters, YouTube chapter text, on-screen badges ──
//
// The compiler emits one action per chapter start: { type: "chapter",
// timestamp (recording seconds), chapterTitle, chapterBadge? }. The renderer
// places each on the FINAL timeline with the same remap overlays use (skip →
// speed → inserts: recording → post-skip/speed → final; an insert AT the
// chapter's own position comes after its start), then shifts it by the title
// card. After the final encode it:
//   - writes them into the MP4 (ffmetadata [CHAPTER] blocks, stream-copy remux
//     with -map_chapters — the final graph is not touched),
//   - writes video/chapters_<label>.txt (YouTube description format) and
//     video/chapters_<label>.json,
//   - returns them (seconds, and "m:ss" timecodes).
// Chapter list rules (also documented in api/MANUAL.md):
//   - the list starts at 0:00 (YouTube requires it): a first chapter within 1 s
//     of the start is moved to 0:00; otherwise — a title card, or no chapter on
//     the first step — an implicit lead chapter ("Intro" by default) covers it;
//   - chapters starting within 0.5 s of each other merge (the later title wins);
//   - the last chapter runs to the end of the video (the end card included).

import * as fs from "fs";
import * as path from "path";
import { ffmpegSync, probeDuration } from "./ffmpeg";
import { assAlpha, assShape, assText, assTime } from "./fx-ass";
import { roundedRect, type FrameSize } from "./fx-geometry";

/** What the renderer reads from a chapter action. */
export interface ChapterAction {
  type: string;
  timestamp: number;
  chapterTitle?: string;
  chapterBadge?: boolean;
}

/** One chapter of the finished video (seconds from its very start, cards included). */
export interface Chapter {
  title: string;
  start: number;
  end: number;
  /** start as YouTube writes it: m:ss (h:mm:ss from an hour on) */
  timecode: string;
  /** the lead chapter NaraScreen added (title card / before the first chapter) */
  implicit?: true;
}

/** A chapter start on the main video's own timeline (no cards). */
export interface ChapterPoint {
  title: string;
  at: number;
  badge: boolean;
}

/** Where the lead chapter's start snaps to 0:00 instead of getting an implicit chapter. */
const SNAP_TO_ZERO_SEC = 1;
const MERGE_SEC = 0.5;
/** YouTube's rules for description chapters. */
export const YOUTUBE_MIN_CHAPTERS = 3;
export const YOUTUBE_MIN_CHAPTER_SEC = 10;

/** m:ss, or h:mm:ss from an hour on (seconds floored, as YouTube reads them). */
export function timecode(sec: number): string {
  const s = Math.max(0, Math.floor(sec + 1e-6));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}

/** The chapter actions, placed on the main video's final timeline by `finalAt` (sorted). */
export function chapterPoints(actions: ChapterAction[], finalAt: (ts: number) => number): ChapterPoint[] {
  return actions
    .filter((a) => a.type === "chapter" && !!a.chapterTitle?.trim())
    .map((a) => ({ title: a.chapterTitle!.trim(), at: Math.max(0, finalAt(a.timestamp)), badge: !!a.chapterBadge }))
    .sort((a, b) => a.at - b.at);
}

/**
 * The finished video's chapter list: points shifted by the intro card, merged,
 * starting at 0:00, each ending where the next begins (the last at `totalSec`).
 * Empty when there are no points.
 */
export function buildChapters(points: ChapterPoint[], opts: { introSec?: number; totalSec: number; leadTitle?: string }): Chapter[] {
  const intro = opts.introSec ?? 0;
  const total = opts.totalSec;
  const starts: { title: string; start: number; implicit?: true }[] = [];
  for (const p of points) {
    const start = Math.min(p.at + intro, Math.max(0, total - 0.5));
    const last = starts[starts.length - 1];
    if (last && start - last.start < MERGE_SEC) last.title = p.title;
    else starts.push({ title: p.title, start });
  }
  if (!starts.length) return [];
  if (starts[0].start < SNAP_TO_ZERO_SEC && intro === 0) starts[0].start = 0;
  if (starts[0].start > 0) starts.unshift({ title: opts.leadTitle?.trim() || "Intro", start: 0, implicit: true });
  return starts.map((c, i) => {
    const end = i + 1 < starts.length ? starts[i + 1].start : total;
    const r = (x: number) => Math.round(x * 1000) / 1000;
    return { title: c.title, start: r(c.start), end: r(end), timecode: timecode(c.start), ...(c.implicit ? { implicit: true as const } : {}) };
  });
}

/**
 * The list as YouTube gets it: an implicit lead chapter shorter than 10 s (a
 * title card) would make YouTube drop every chapter, so it is folded into the
 * next one, which then starts at 0:00. (The MP4 and the JSON keep it.)
 */
export function youtubeList(chapters: Chapter[]): Chapter[] {
  if (chapters.length > 1 && chapters[0].implicit && chapters[1].start < YOUTUBE_MIN_CHAPTER_SEC) {
    return [{ ...chapters[1], start: 0, timecode: timecode(0) }, ...chapters.slice(2)];
  }
  return chapters;
}

/** The YouTube description block: one "m:ss Title" line per chapter (the first is 0:00). */
export function youtubeChapters(all: Chapter[]): string {
  const chapters = youtubeList(all);
  return chapters.map((c) => `${c.timecode} ${c.title.replace(/\s+/g, " ")}`).join("\n") + (chapters.length ? "\n" : "");
}

/** Where a chapter list breaks YouTube's rules (≥ 3 chapters, each ≥ 10 s). Empty = fine. */
export function youtubeIssues(all: Chapter[]): string[] {
  const chapters = youtubeList(all);
  if (!chapters.length) return [];
  const out: string[] = [];
  if (chapters.length < YOUTUBE_MIN_CHAPTERS) {
    out.push(`only ${chapters.length} chapter${chapters.length > 1 ? "s" : ""} — YouTube shows chapters only when there are at least ${YOUTUBE_MIN_CHAPTERS}`);
  }
  // Timecodes are whole seconds: judge each chapter the way YouTube will.
  const short = chapters.filter((c, i) => (i + 1 < chapters.length ? Math.floor(chapters[i + 1].start) : c.end) - Math.floor(c.start) < YOUTUBE_MIN_CHAPTER_SEC);
  if (short.length) {
    out.push(
      `${short.map((c) => `"${c.title}" (${timecode(c.start)}, ${(c.end - c.start).toFixed(1)}s)`).join(", ")} ` +
        `${short.length > 1 ? "are" : "is"} shorter than ${YOUTUBE_MIN_CHAPTER_SEC}s — YouTube ignores all chapters when one is`,
    );
  }
  return out;
}

/** An ffmetadata file (;FFMETADATA1) with one [CHAPTER] per chapter, in milliseconds. */
export function ffmetadata(chapters: Chapter[]): string {
  const esc = (s: string) => s.replace(/[\\=;#\n]/g, (c) => `\\${c}`);
  const lines = [";FFMETADATA1"];
  for (const c of chapters) {
    lines.push("[CHAPTER]", "TIMEBASE=1/1000", `START=${Math.round(c.start * 1000)}`, `END=${Math.round(c.end * 1000)}`, `title=${esc(c.title)}`);
  }
  return lines.join("\n") + "\n";
}

/**
 * On-screen chapter badges (SCREEN-SPACE: drawn over the finished frame, above
 * any camera crop, like subtitles): a dark rounded pill with an accent bar and
 * the title, top-left, sliding in at the chapter's start, for ~2.6 s.
 * Only points with `badge` (chapters.onScreen). Times on the main timeline.
 */
export function chapterBadgeEvents(points: ChapterPoint[], res: FrameSize, totalDuration: number, scaleOverride?: number): string[] {
  const out: string[] = [];
  const scale = scaleOverride ?? Math.max(0.6, Math.min(res.height, res.width * 0.625) / 900);
  const fs = Math.round(22 * scale * 1.25);
  const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
  points.forEach((p, i) => {
    if (!p.badge) return;
    const next = points[i + 1]?.at ?? Infinity;
    const start = p.at + 0.15;
    const end = Math.min(start + 2.6, next - 0.05, totalDuration);
    if (!(end - start > 0.6)) return;
    const text = p.title.length > 60 ? `${p.title.slice(0, 57)}…` : p.title;
    const graphemes = [...segmenter.segment(text)].length;
    const ph = Math.round(fs * 1.5);
    const bar = Math.round(5 * scale);
    const padX = Math.round(16 * scale);
    const pw = Math.round(graphemes * fs * 0.52 + 2 * padX + bar);
    const x = Math.round(28 * scale);
    const y = Math.round(28 * scale);
    const fade = "\\fad(220,320)";
    const move = (dx: number) => `\\move(${x - Math.round(14 * scale) + dx},${y},${x + dx},${y},0,260)`;
    // Pill (dark, 78 %), accent bar, then the title; \move slides each in from the left.
    const pill = assShape(7, start, end, roundedRect(0, 0, pw, ph, ph * 0.28), `\\1c&H271811&\\1a${assAlpha(0.78)}\\bord0\\shad0${fade}`);
    out.push(pill.replace(/\\pos\(\d+,\d+\)/, move(0)));
    const accent = assShape(8, start, end, roundedRect(0, 0, bar, ph, bar / 2), `\\1c&HE5464F&\\bord0\\shad0${fade}`);
    out.push(accent.replace(/\\pos\(\d+,\d+\)/, move(0)));
    out.push(
      `Dialogue: 9,${assTime(start)},${assTime(end)},CLabel,,0,0,0,,` +
        `{\\an4\\move(${x - Math.round(14 * scale) + bar + padX},${y + ph / 2},${x + bar + padX},${y + ph / 2},0,260)` +
        `\\bord0\\shad0\\3a&HFF&\\4a&HFF&\\b1\\1c&HFFFFFF&\\fsp0\\fs${fs}${fade}}${assText(text)}`,
    );
  });
  return out;
}

/**
 * After the final encode: write the chapters into `finalPath` (stream copy),
 * and chapters_<label>.txt / .json next to it. Returns the list (empty when the
 * project has no chapters — nothing is written then).
 */
export function applyChapters(opts: {
  actions: ChapterAction[];
  finalAt: (ts: number) => number;
  finalPath: string;
  label: string;
  tempDir: string;
  introPath?: string;
  leadTitle?: string;
  emit: (msg: string) => void;
}): { chapters: Chapter[]; files?: { youtube: string; json: string } } {
  const points = chapterPoints(opts.actions, opts.finalAt);
  if (!points.length) return { chapters: [] };
  const introSec = opts.introPath && fs.existsSync(opts.introPath) ? probeDuration(opts.introPath) : 0;
  const totalSec = probeDuration(opts.finalPath);
  const chapters = buildChapters(points, { introSec, totalSec, leadTitle: opts.leadTitle });
  opts.emit(`\n[Chapters] ${chapters.length}: ${chapters.map((c) => `${c.timecode} ${c.title}`).join(" | ")}`);

  const meta = path.join(opts.tempDir, "chapters.ffmeta");
  fs.writeFileSync(meta, ffmetadata(chapters));
  const tmp = opts.finalPath.replace(/\.mp4$/i, "") + ".chapters.mp4";
  const r = ffmpegSync([
    "-y", "-i", opts.finalPath, "-f", "ffmetadata", "-i", meta,
    "-map", "0", "-map_metadata", "1", "-map_chapters", "1", "-c", "copy", "-movflags", "+faststart", tmp,
  ]);
  if (r.status === 0 && fs.existsSync(tmp) && fs.statSync(tmp).size > 0) fs.renameSync(tmp, opts.finalPath);
  else {
    fs.rmSync(tmp, { force: true });
    opts.emit(`  Warning: could not write chapters into the video (ffmpeg exit ${r.status}); the chapter files are still written`);
  }

  const dir = path.dirname(opts.finalPath);
  const files = { youtube: path.join(dir, `chapters_${opts.label}.txt`), json: path.join(dir, `chapters_${opts.label}.json`) };
  fs.writeFileSync(files.youtube, youtubeChapters(chapters));
  fs.writeFileSync(files.json, JSON.stringify(chapters, null, 2) + "\n");
  for (const issue of youtubeIssues(chapters)) opts.emit(`  Warning: chapters: ${issue}`);
  return { chapters, files };
}
