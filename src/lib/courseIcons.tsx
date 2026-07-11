import {
  BookOpen,
  Calculator,
  FlaskConical,
  Atom,
  Code2,
  Database,
  LineChart,
  Globe,
  Microscope,
  Music,
  Palette,
  Brain,
  Briefcase,
  Leaf,
  HeartPulse,
  Landmark,
  Languages,
  Camera,
  Cpu,
  Network,
  Sigma,
  Ruler,
  Compass,
  GraduationCap,
  type LucideIcon,
} from "lucide-react";

const ICON_MAP: Record<string, LucideIcon> = {
  BookOpen,
  Calculator,
  FlaskConical,
  Atom,
  Code2,
  Database,
  LineChart,
  Globe,
  Microscope,
  Music,
  Palette,
  Brain,
  Briefcase,
  Leaf,
  HeartPulse,
  Landmark,
  Languages,
  Camera,
  Cpu,
  Network,
  Sigma,
  Ruler,
  Compass,
  GraduationCap,
};

export const ICON_NAMES = Object.keys(ICON_MAP);

export function getIcon(name?: string | null): LucideIcon {
  if (name && ICON_MAP[name]) return ICON_MAP[name];
  return BookOpen;
}

const FALLBACK_COLORS = [
  "oklch(0.55 0.16 165)",
  "oklch(0.55 0.18 250)",
  "oklch(0.6 0.16 60)",
  "oklch(0.6 0.16 200)",
  "oklch(0.55 0.18 300)",
  "oklch(0.6 0.15 30)",
];

function hash(str: string): number {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) | 0;
  return Math.abs(h);
}

export function fallbackColor(seed: string): string {
  return FALLBACK_COLORS[hash(seed) % FALLBACK_COLORS.length];
}

export function resolveColor(color?: string | null, seed = ""): string {
  return color?.trim() ? color : fallbackColor(seed);
}

export function CourseGlyph({
  icon,
  color,
  seed,
  size = "md",
  track = false,
  className,
}: {
  icon?: string | null;
  color?: string | null;
  seed?: string;
  size?: "sm" | "md" | "lg" | "xl";
  track?: boolean;
  className?: string;
}) {
  const Icon = getIcon(icon);
  const resolved = resolveColor(color, seed ?? icon ?? "slams");
  const box =
    size === "sm"
      ? "h-9 w-9 rounded-lg"
      : size === "lg"
        ? "h-14 w-14 rounded-2xl"
        : size === "xl"
          ? "h-20 w-20 rounded-3xl"
          : "h-11 w-11 rounded-xl";
  const iconSize = size === "sm" ? "h-4 w-4" : size === "lg" ? "h-7 w-7" : size === "xl" ? "h-9 w-9" : "h-5 w-5";

  return (
    <div
      className={`grid shrink-0 place-items-center text-white shadow-elegant ring-1 ring-white/30 dark:ring-black/20 ${box} ${className ?? ""}`}
      style={{
        backgroundImage: `linear-gradient(135deg, ${resolved}, color-mix(in oklch, ${resolved} 62%, white))`,
      }}
      aria-hidden
    >
      <Icon className={iconSize} {...(track ? { strokeWidth: 2.2 } : {})} />
    </div>
  );
}

export const TrackGlyph = CourseGlyph;
