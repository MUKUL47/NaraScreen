import {
  Pause,
  ZoomIn,
  Mic,
  Lightbulb,
  Gauge,
  Scissors,
  Type,
  Music,
  EyeOff,
  VolumeOff,
  Circle,
  FolderOpen,
  Save,
  Play,
  Clapperboard,
  History,
  Plus,
  Trash2,
  Clock,
} from "lucide-react";

const ICON_MAP: Record<string, typeof Pause> = {
  pause: Pause,
  zoom: ZoomIn,
  narrate: Mic,
  spotlight: Lightbulb,
  speed: Gauge,
  skip: Scissors,
  callout: Type,
  music: Music,
  blur: EyeOff,
  mute: VolumeOff,
};

interface ActionIconProps {
  type: string;
  size?: number;
  className?: string;
}

export function ActionIcon({ type, size = 14, className }: ActionIconProps) {
  const Icon = ICON_MAP[type] || Circle;
  return <Icon size={size} className={className} />;
}

// Re-export individual icons for toolbar use
export {
  Circle as RecordIcon,
  FolderOpen as OpenIcon,
  Save as SaveIcon,
  Play as PreviewIcon,
  Clapperboard as ProduceIcon,
  History as VersionsIcon,
  Plus as PlusIcon,
  Trash2 as TrashIcon,
  Clock as ClockIcon,
};
