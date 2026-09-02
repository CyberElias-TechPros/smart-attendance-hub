import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";

/** Must match the pre-paint bootstrap script in index.html. */
const THEME_KEY = "slams:theme";

function applyTheme(theme: "light" | "dark") {
  const root = document.documentElement;
  root.classList.toggle("dark", theme === "dark");
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {
    // Storage can be unavailable in private mode; the theme still applies for this page view.
  }
}

export function ThemeToggle({ className }: { className?: string }) {
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    let initial: "light" | "dark" = "light";
    try {
      const saved = localStorage.getItem(THEME_KEY);
      if (saved === "light" || saved === "dark") initial = saved;
      else if (window.matchMedia("(prefers-color-scheme: dark)").matches) initial = "dark";
    } catch {
      // Fall back to the light theme when storage or matchMedia is blocked.
    }
    setTheme(initial);
    applyTheme(initial);
    setMounted(true);
  }, []);

  const toggle = () => {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    applyTheme(next);
  };

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label="Toggle theme"
      className={
        "grid h-9 w-9 place-items-center rounded-lg border border-border/70 bg-background/60 text-muted-foreground backdrop-blur transition hover:text-foreground hover:shadow-elegant " +
        (className ?? "")
      }
    >
      <span suppressHydrationWarning>
        {mounted && theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
      </span>
    </button>
  );
}
