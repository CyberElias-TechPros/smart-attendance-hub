import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";

/**
 * Pointer-following ambient glow. Drop inside a `relative` section — it
 * paints a soft radial light that trails the cursor (rAF-throttled).
 * Disabled on touch devices and for reduced motion.
 */
export function Spotlight({ className }: { className?: string }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    const parent = el?.parentElement;
    if (!el || !parent) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    if (window.matchMedia("(pointer: coarse)").matches) return;
    let raf = 0;
    const onMove = (e: PointerEvent) => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const r = parent.getBoundingClientRect();
        const x = e.clientX - r.left;
        const y = e.clientY - r.top;
        el.style.background = `radial-gradient(520px circle at ${x}px ${y}px, oklch(0.72 0.14 165 / 0.16), transparent 65%)`;
      });
    };
    const onLeave = () => {
      cancelAnimationFrame(raf);
      el.style.background = "transparent";
    };
    parent.addEventListener("pointermove", onMove);
    parent.addEventListener("pointerleave", onLeave);
    return () => {
      cancelAnimationFrame(raf);
      parent.removeEventListener("pointermove", onMove);
      parent.removeEventListener("pointerleave", onLeave);
    };
  }, []);

  return (
    <div
      ref={ref}
      aria-hidden
      className={cn(
        "pointer-events-none absolute inset-0 transition-[background] duration-300",
        className,
      )}
    />
  );
}
