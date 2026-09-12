import { type ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Layered, animated backdrop: drifting aurora blobs + subtle grid + noise.
 * Purely decorative — sits behind content (absolute, -z-10).
 */
export function AuroraBackground({
  className,
  children,
}: {
  className?: string;
  children?: ReactNode;
}) {
  return (
    <div className={cn("relative isolate overflow-hidden", className)}>
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute inset-0 bg-aurora animate-aurora opacity-70" />
        <div className="absolute inset-0 bg-grid opacity-60 [mask-image:radial-gradient(70%_70%_at_50%_30%,black,transparent)]" />
        <div className="absolute inset-0 bg-noise opacity-[0.025] mix-blend-overlay" />
      </div>
      {children}
    </div>
  );
}

/** Floating decorative orb. */
export function Orb({
  className,
  color = "oklch(0.5 0.13 165 / 0.4)",
}: {
  className?: string;
  color?: string;
}) {
  return (
    <div
      aria-hidden
      className={cn("pointer-events-none absolute rounded-full blur-3xl animate-float", className)}
      style={{ background: color }}
    />
  );
}
