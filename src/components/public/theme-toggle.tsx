"use client";

import { useEffect, useState } from "react";

const STORAGE_KEY = "ewrc-theme";

function getStoredTheme(): "light" | "dark" {
  if (typeof window === "undefined") return "dark";
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === "light" || v === "dark") return v;
  } catch {
    /* ignore */
  }
  return "dark";
}

export function ThemeToggle() {
  const [theme, setTheme] = useState<"light" | "dark">("dark");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    setTheme(getStoredTheme());
  }, []);

  useEffect(() => {
    if (!mounted) return;
    const root = document.documentElement;
    if (theme === "light") root.classList.add("light");
    else root.classList.remove("light");
    try {
      localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      /* ignore */
    }
  }, [theme, mounted]);

  const next = theme === "dark" ? "light" : "dark";

  return (
    <button
      type="button"
      onClick={() => setTheme(next)}
      className="rounded-md border border-[var(--ewrc-border-ui)] bg-[var(--ewrc-surface-raised)] px-2.5 py-1.5 text-xs font-medium text-[var(--ewrc-muted)] transition-colors hover:border-[var(--ewrc-brand)] hover:text-[var(--ewrc-brand)]"
      title={`Switch to ${next} mode`}
      aria-label={`Switch to ${next} mode`}
    >
      {theme === "dark" ? "Light" : "Dark"}
    </button>
  );
}
