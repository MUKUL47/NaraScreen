/** Action type → Tailwind background color class */
export const ACTION_COLORS: Record<string, string> = {
  pause: "bg-amber-500",
  zoom: "bg-blue-500",
  narrate: "bg-green-500",
  spotlight: "bg-purple-500",
  speed: "bg-orange-500",
  skip: "bg-red-500",
  callout: "bg-cyan-500",
  music: "bg-pink-500",
};

/** Action type → short label for timeline markers */
export const ACTION_LABELS: Record<string, string> = {
  pause: "P",
  zoom: "Z",
  narrate: "N",
  spotlight: "S",
  speed: "F",
  skip: "X",
  callout: "T",
  music: "M",
};

/** Action type → Tailwind text color class */
export const ACTION_TEXT_COLORS: Record<string, string> = {
  pause: "text-amber-400",
  zoom: "text-blue-400",
  narrate: "text-green-400",
  spotlight: "text-purple-400",
  speed: "text-orange-400",
  skip: "text-red-400",
  callout: "text-cyan-400",
  music: "text-pink-400",
};

/** Action type → display name */
export const ACTION_DISPLAY_NAMES: Record<string, string> = {
  pause: "Pause",
  zoom: "Zoom",
  narrate: "Narrate",
  spotlight: "Spotlight",
  speed: "Speed Ramp",
  skip: "Skip / Cut",
  callout: "Text Callout",
  music: "Music",
};
