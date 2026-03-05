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
  blur: "bg-indigo-500",
  mute: "bg-rose-500",
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
  blur: "B",
  mute: "🔇",
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
  blur: "text-indigo-400",
  mute: "text-rose-400",
};

/** Action type → semi-transparent pill background for timeline lanes */
export const ACTION_BG_COLORS: Record<string, string> = {
  pause: "bg-amber-500/20",
  zoom: "bg-blue-500/20",
  narrate: "bg-green-500/20",
  spotlight: "bg-purple-500/20",
  speed: "bg-orange-500/20",
  skip: "bg-red-500/20",
  callout: "bg-cyan-500/20",
  music: "bg-pink-500/20",
  blur: "bg-indigo-500/20",
  mute: "bg-rose-500/20",
};

/** Action type → border color for selected pills */
export const ACTION_BORDER_COLORS: Record<string, string> = {
  pause: "border-amber-400",
  zoom: "border-blue-400",
  narrate: "border-green-400",
  spotlight: "border-purple-400",
  speed: "border-orange-400",
  skip: "border-red-400",
  callout: "border-cyan-400",
  music: "border-pink-400",
  blur: "border-indigo-400",
  mute: "border-rose-400",
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
  blur: "Blur",
  mute: "Mute",
};
