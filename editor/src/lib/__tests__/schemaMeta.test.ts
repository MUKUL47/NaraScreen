import { FxEntrySchema, RESOLUTIONS, TTS_LANGUAGES, type FxVerb } from "../../../api/schema";
import {
  API_DEFAULTS, CALLOUT_STYLES, DURATION_KEYWORDS, LANGUAGE_OPTIONS, LIMITS, RESOLUTION_OPTIONS, clampToMeta, durationMeta,
  effectiveMin, enumMeta, fieldMeta, numberMeta, type MetaScope, type ScopeFields,
} from "../schemaMeta";
import { assert, test } from "./_node";

test("every default is the one the schema's description states", () => {
  let checked = 0;
  for (const [scope, fields] of Object.entries(API_DEFAULTS) as [MetaScope, Record<string, unknown>][]) {
    for (const [field, value] of Object.entries(fields)) {
      const desc = fieldMeta(scope, field as ScopeFields[typeof scope]).description ?? "";
      if (!/default/i.test(desc)) continue; // e.g. speed.factor: required, no default in the schema
      const shown = Array.isArray(value) ? JSON.stringify(value) : String(value);
      assert.ok(desc.includes(shown), `${scope}.${field}: "${shown}" is not in "${desc}"`);
      checked++;
    }
  }
  assert.ok(checked >= 25, `only ${checked} defaults checked`);
});

test("ranges come from the schema (D14 / D27)", () => {
  const fs = numberMeta("callout", "fontSize");
  assert.deepEqual([fs.min, fs.max, fs.int, fs.step, fs.default], [12, 96, true, 1, 28]);
  assert.equal(numberMeta("arrow", "fontSize").default, 24);
  const zd = numberMeta("zoom", "zoomDuration");
  assert.deepEqual([zd.min, zd.minExclusive, zd.max, zd.default, zd.unit], [0, true, 10, 0.8, "s"]);
  assert.deepEqual([numberMeta("zoom", "zoomHold").max, numberMeta("zoom", "zoomHold").default], [60, 2]);
  assert.deepEqual([numberMeta("blur", "radius").min, numberMeta("blur", "radius").max], [1, 100]);
  assert.deepEqual([numberMeta("speed", "factor").min, numberMeta("speed", "factor").max, numberMeta("speed", "factor").step], [0.25, 4, 0.05]);
  assert.deepEqual([numberMeta("tts", "speed").min, numberMeta("tts", "speed").max], [0.5, 2]);
  const conv = numberMeta("spotlight", "converge");
  assert.deepEqual([conv.min, conv.max, conv.example, conv.default], [0.1, 3, 0.6, undefined]);
  assert.equal(numberMeta("spotlight", "feather").example, 24);
  assert.deepEqual([numberMeta("narrate", "subtitleSize").min, numberMeta("narrate", "subtitleSize").max], [16, 64]);
  assert.equal(numberMeta("pause", "seconds").max, 60);
  const dur = durationMeta("blur");
  assert.deepEqual([dur.seconds.max, dur.default, [...dur.keywords]], [120, "step-end", ["auto", "step-end", "end"]]);
  assert.deepEqual([...durationMeta("card").keywords], ["auto"]);
  assert.equal(durationMeta("card").seconds.min, 1);
  assert.deepEqual(LIMITS, { regionsMax: 10, zoomTargetsMax: 10, overlaySecondsMax: 120, pauseSecondsMax: 60, rangeSecondsMax: 3600, zoomDurationMax: 10, zoomHoldMax: 60, fontSize: { min: 12, max: 96 } });
});

test("clampToMeta respects exclusive bounds and integers", () => {
  const vol = numberMeta("music", "volume");
  assert.equal(vol.minExclusive, true);
  assert.ok(clampToMeta(vol, 0) > 0);
  assert.equal(clampToMeta(vol, 5), 1);
  assert.equal(clampToMeta(numberMeta("callout", "fontSize"), 200.4), 96);
  assert.equal(clampToMeta(numberMeta("callout", "fontSize"), 30.6), 31);
  assert.equal(clampToMeta(numberMeta("zoom", "zoomDuration"), Number.NaN), 0.8);
  assert.equal(effectiveMin(numberMeta("pause", "seconds")), 0.01);
});

test("enums and lists match the schema", () => {
  assert.deepEqual([...RESOLUTION_OPTIONS], ["native", ...Object.keys(RESOLUTIONS)]);
  assert.deepEqual([...CALLOUT_STYLES], ["label", "lower-third", "step-counter"]);
  assert.deepEqual([...DURATION_KEYWORDS], ["auto", "step-end", "end"]);
  assert.deepEqual(LANGUAGE_OPTIONS.map((l) => l.code), [...TTS_LANGUAGES]);
  assert.deepEqual(enumMeta("narrate", "lang").options, [...TTS_LANGUAGES]);
  assert.equal(fieldMeta("arrow", "color").kind, "text");
  assert.equal(fieldMeta("callout", "text").kind === "text" && (fieldMeta("callout", "text") as { localized: boolean }).localized, true);
});

test("every field of every fx has metadata", () => {
  for (const opt of FxEntrySchema.options) {
    const verb = (opt.shape.fx as unknown as { value: FxVerb }).value;
    for (const field of Object.keys(opt.shape)) {
      if (field === "fx") continue;
      const m = fieldMeta(verb, field as ScopeFields[typeof verb]);
      assert.ok(m.kind, `${verb}.${field}`);
    }
  }
  assert.throws(() => fieldMeta("zoom", "nope" as ScopeFields["zoom"]), /no field/);
  assert.throws(() => numberMeta("callout", "style"), /is a enum, not a number/);
});
