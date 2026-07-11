import { type ReactNode } from "react";
import { cn } from "@/lib/utils";

export function RouteTransition({
  children,
  className,
  stagger,
}: {
  children: ReactNode;
  className?: string;
  stagger?: boolean;
}) {
  return <div className={cn("animate-in", stagger && "stagger", className)}>{children}</div>;
}
