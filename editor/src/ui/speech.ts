/** Average narration pace used for the "≈ n s" estimate in TextArea counters. */
export const WORDS_PER_SECOND = 2.6;

/** Estimated seconds to speak a text at WORDS_PER_SECOND. */
export function speechSeconds(text: string): number {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  return words / WORDS_PER_SECOND;
}
