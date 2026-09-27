/** "Detach as video edit" helpers (pure): fold the per-language compiled projects of a job into
 *  one multi-language timeline project, and pick up what only the script knows. */
import type { Card, DemoPlan, DemoScript } from "../../../api/schema";
import type { CalloutPanel, DemoProject, LangMap, TimelineAction, ZoomTarget } from "../../types";
import { DEFAULT_VOICES } from "../../lib/voices";

const put = (m: LangMap | undefined, lang: string, v: string | undefined): LangMap | undefined => (v == null || !v.trim() ? m : { ...(m ?? {}), [lang]: v });
const putN = (m: LangMap<number> | undefined, lang: string, v: number | undefined) => (v == null ? m : { ...(m ?? {}), [lang]: v });

function mergeSpeaker<T extends TimelineAction | ZoomTarget>(base: T, other: T, lang: string): T {
  if (base.narrations?.[lang]) return base;
  const text = other.narrations?.[lang];
  if (!text) return base;
  return {
    ...base,
    narrations: put(base.narrations, lang, text),
    audioPath: put(base.audioPath, lang, other.audioPath?.[lang]),
    audioDuration: putN(base.audioDuration, lang, other.audioDuration?.[lang]),
  };
}

function mergeText(baseText: string | undefined, baseLang: string, otherText: string | undefined, lang: string, map: LangMap | undefined): LangMap | undefined {
  if (!otherText || otherText === baseText || map?.[lang]) return map;
  return { ...(map ?? (baseText ? { [baseLang]: baseText } : {})), [lang]: otherText };
}

/** Merge the compiled projects of several languages (same compiler ids) into `byLang[primary]`. */
export function mergeCompiledLanguages(byLang: Record<string, DemoProject>, primary: string): DemoProject {
  const base = structuredClone(byLang[primary]);
  for (const [lang, other] of Object.entries(byLang)) {
    if (lang === primary) continue;
    const byId = new Map(other.actions.map((a) => [a.id, a]));
    base.actions = base.actions.map((a) => {
      const o = byId.get(a.id);
      if (!o || o.type !== a.type) return a;
      let next = mergeSpeaker(a, o, lang);
      if (a.zoomTargets?.length && o.zoomTargets?.length) {
        next = { ...next, zoomTargets: a.zoomTargets.map((t, k) => (o.zoomTargets![k] ? mergeSpeaker(t, o.zoomTargets![k], lang) : t)) };
      }
      if (a.type === "callout") {
        const calloutTexts = mergeText(a.calloutText, primary, o.calloutText, lang, next.calloutTexts);
        const panels: CalloutPanel[] | undefined = next.calloutPanels?.map((p, k) => {
          const op = o.calloutPanels?.[k];
          const texts = mergeText(p.text, primary, op?.text, lang, p.texts);
          return texts ? { ...p, texts } : p;
        });
        next = { ...next, ...(calloutTexts ? { calloutTexts } : {}), ...(panels ? { calloutPanels: panels } : {}) };
      }
      return next;
    });
  }
  const langs = [...new Set([primary, ...Object.keys(byLang)])];
  base.tts = { ...base.tts, languages: langs };
  return base;
}

const absFrom = (dir: string, p: string) => (p.startsWith("/") || /^[A-Za-z]:[\\/]/.test(p) ? p : `${dir}/${p.replace(/^\.\//, "")}`);

/** What the script adds on top of the compiled project: cards, plan, output, languages, voices. */
export function scriptExtras(script: Partial<DemoScript> | null | undefined, scriptPath: string): Partial<DemoProject> & { voices?: Record<string, string> } {
  if (!script || typeof script !== "object") return {};
  const dir = scriptPath.replace(/[\\/][^\\/]*$/, "");
  const card = (c: Card | undefined): Card | undefined => (c ? { ...c, ...(c.logo ? { logo: absFrom(dir, c.logo) } : {}) } : undefined);
  const out: Partial<DemoProject> & { voices?: Record<string, string> } = {};
  if (script.intro) out.intro = card(script.intro);
  if (script.outro) out.outro = card(script.outro);
  if (script.plan) out.plan = script.plan as DemoPlan;
  if (script.tts?.voices) out.voices = script.tts.voices as Record<string, string>;
  return out;
}

/** voices[lang] with `voice` first and the rest of the catalog after it. */
export function voiceList(lang: string, voice: string): string[] {
  return [voice, ...(DEFAULT_VOICES[lang] ?? []).filter((v) => v !== voice)];
}
