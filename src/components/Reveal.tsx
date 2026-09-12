import { useEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

type RevealVariant = "up" | "left" | "right" | "scale" | "clip";

const HIDDEN: Record<RevealVariant, string> = {
  up: "motion-safe:translate-y-8 motion-safe:opacity-0",
  left: "motion-safe:-translate-x-10 motion-safe:opacity-0",
  right: "motion-safe:translate-x-10 motion-safe:opacity-0",
  scale: "motion-safe:scale-[0.96] motion-safe:opacity-0",
  clip: "motion-safe:opacity-0 motion-safe:blur-sm",
};

/**
 * Scroll-triggered reveal: children rest hidden (transform + opacity, GPU
 * friendly) until they enter the viewport, then ease into place once.
 * Fully static when `prefers-reduced-motion` is set (initial state is only
 * applied under `motion-safe`, and the observer short-circuits to visible).
 */
export function Reveal({
  children,
  className,
  variant = "up",
  delay = 0,
}: {
  children: ReactNode;
  className?: string;
  variant?: RevealVariant;
  /** Stagger siblings by passing 0 / 80 / 160 … */
  delay?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setShown(true);
      return;
    }
    if (!("IntersectionObserver" in window)) {
      setShown(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          setShown(true);
          io.disconnect();
        }
      },
      { threshold: 0.12, rootMargin: "0px 0px -6% 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      style={{ transitionDelay: `${delay}ms` }}
      className={cn(
        "motion-safe:transition-all motion-safe:duration-700 motion-safe:ease-[cubic-bezier(0.22,1,0.36,1)] motion-safe:will-change-transform",
        !shown && HIDDEN[variant],
        className,
      )}
    >
      {children}
    </div>
  );
}
