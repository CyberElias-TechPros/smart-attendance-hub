import { cn } from "@/lib/utils";

const PALETTE = [
  "from-emerald-500 to-teal-500",
  "from-sky-500 to-indigo-500",
  "from-violet-500 to-fuchsia-500",
  "from-amber-500 to-orange-500",
  "from-rose-500 to-pink-500",
  "from-cyan-500 to-blue-500",
];

function hash(str: string): number {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) | 0;
  return Math.abs(h);
}

export function Avatar({
  name,
  seed,
  size = "md",
  className,
}: {
  name: string;
  seed?: string;
  size?: "sm" | "md" | "lg" | "xl";
  className?: string;
}) {
  const key = seed ?? name;
  const initials = name
    .split(" ")
    .map((w) => w[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
  const grad = PALETTE[hash(key) % PALETTE.length];

  const dims =
    size === "sm"
      ? "h-8 w-8 text-xs"
      : size === "lg"
        ? "h-12 w-12 text-base"
        : size === "xl"
          ? "h-16 w-16 text-xl"
          : "h-10 w-10 text-sm";

  return (
    <div
      className={cn(
        "grid place-items-center rounded-full bg-gradient-to-br font-semibold text-white shadow-elegant ring-2 ring-white/40 dark:ring-black/20",
        grad,
        dims,
        className,
      )}
    >
      {initials}
    </div>
  );
}
