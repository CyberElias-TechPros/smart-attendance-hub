import { useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Home, LogOut, Search } from "lucide-react";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";

export type PaletteNavItem = {
  to: string;
  label: string;
  description?: string;
  icon: React.ComponentType<{ className?: string }>;
};

/**
 * ⌘K / Ctrl+K dashboard search: jump to any section or sign out without
 * touching the mouse. Rendered once by AppShell; the trigger button lives
 * in the sidebar and the mobile top bar.
 */
export function CommandPalette({
  open,
  onOpenChange,
  nav,
  onLogout,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  nav: PaletteNavItem[];
  onLogout: () => void;
}) {
  const navigate = useNavigate();

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        onOpenChange(!open);
      }
    };
    document.addEventListener("keydown", down);
    return () => document.removeEventListener("keydown", down);
  }, [open, onOpenChange]);

  const go = (to: string) => {
    onOpenChange(false);
    navigate({ to });
  };

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandInput placeholder="Jump to a section, or type to search…" />
      <CommandList>
        <CommandEmpty>No matches. Try “sessions”, “reports”…</CommandEmpty>
        <CommandGroup heading="Go to">
          {nav.map((n) => (
            <CommandItem key={n.to} value={`${n.label} ${n.description}`} onSelect={() => go(n.to)}>
              <n.icon className="mr-2 h-4 w-4 text-muted-foreground" />
              <span>{n.label}</span>
              <span className="ml-auto text-xs text-muted-foreground">{n.description}</span>
            </CommandItem>
          ))}
        </CommandGroup>
        <CommandSeparator />
        <CommandGroup heading="Actions">
          <CommandItem value="back to site home" onSelect={() => go("/")}>
            <Home className="mr-2 h-4 w-4 text-muted-foreground" />
            <span>Back to site</span>
          </CommandItem>
          <CommandItem
            value="sign out log out"
            onSelect={() => {
              onOpenChange(false);
              onLogout();
            }}
          >
            <LogOut className="mr-2 h-4 w-4 text-muted-foreground" />
            <span>Sign out</span>
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}

/** The fake-search trigger button shown in the sidebar / mobile bar. */
export function PaletteTrigger({ onClick, compact }: { onClick: () => void; compact?: boolean }) {
  if (compact) {
    return (
      <button
        type="button"
        onClick={onClick}
        aria-label="Search (Ctrl+K)"
        className="rounded-md p-2 text-muted-foreground transition hover:bg-accent/40 hover:text-foreground"
      >
        <Search className="h-5 w-5" />
      </button>
    );
  }
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-2 rounded-lg border border-border/70 bg-background/60 px-3 py-2 text-sm text-muted-foreground transition hover:border-primary/40 hover:text-foreground"
    >
      <Search className="h-4 w-4" />
      <span className="flex-1 text-left">Search…</span>
      <kbd className="rounded border border-border/70 bg-muted/60 px-1.5 py-0.5 font-mono text-[10px]">
        ⌘K
      </kbd>
    </button>
  );
}
