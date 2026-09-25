/** Kokoro TTS catalog: languages, Kokoro lang codes, and voice IDs.
 *  Plain data so both the renderer and the headless CLI (api/) can import it. */

export const LANG_CODES: Record<string, string> = {
  en: "a", "en-gb": "b", hi: "h", es: "e", fr: "f", ja: "j", zh: "z",
  pt: "p", it: "i",
};

export const LANG_LABELS: Record<string, string> = {
  en: "English", "en-gb": "British English", hi: "Hindi", es: "Spanish",
  fr: "French", ja: "Japanese", zh: "Chinese", pt: "Brazilian Portuguese", it: "Italian",
};

/** Default voices per language (Kokoro voice IDs). The first voice is the default. */
export const DEFAULT_VOICES: Record<string, string[]> = {
  en: ["af_heart", "af_bella", "af_alloy", "af_aoede", "af_jessica", "af_kore", "af_nicole", "af_nova", "af_river", "af_sarah", "af_sky", "am_adam", "am_echo", "am_eric", "am_fenrir", "am_liam", "am_michael", "am_onyx", "am_puck", "am_santa"],
  "en-gb": ["bf_alice", "bf_emma", "bf_isabella", "bf_lily", "bm_daniel", "bm_fable", "bm_george", "bm_lewis"],
  hi: ["hf_alpha", "hf_beta", "hm_omega", "hm_psi"],
  es: ["ef_dora", "em_alex", "em_santa"],
  fr: ["ff_siwis"],
  ja: ["jf_alpha", "jf_gongitsune", "jf_nezumi", "jf_tebukuro", "jm_kumo"],
  zh: ["zf_xiaobei", "zf_xiaoni", "zf_xiaoxiao", "zf_xiaoyi", "zm_yunjian", "zm_yunxi", "zm_yunxia", "zm_yunyang"],
  pt: ["pf_dora", "pm_alex", "pm_santa"],
  it: ["if_sara", "im_nicola"],
};
