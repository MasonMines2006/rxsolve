"use client";
/** Header theme control (UI-07). Persists per viewer and switches without a reload. */
import { useEffect, useState } from "react";

const THEMES = ["dark", "light", "aero"] as const;
type Theme = (typeof THEMES)[number];

function isTheme(value: string | undefined): value is Theme {
  return THEMES.includes(value as Theme);
}

function themeLabel(theme: Theme) {
  return theme === "aero" ? "Frutiger Aero" : theme[0]!.toUpperCase() + theme.slice(1);
}

export function ThemeSwitcher() {
  const [theme, setTheme] = useState<Theme>("dark");

  useEffect(() => {
    const activeTheme = document.documentElement.dataset.theme;
    if (isTheme(activeTheme)) setTheme(activeTheme);
  }, []);

  const pick = (nextTheme: Theme) => {
    document.documentElement.dataset.theme = nextTheme;
    try {
      localStorage.setItem("rxsolve-theme", nextTheme);
    } catch {
      // The in-memory theme still applies when storage is unavailable.
    }
    setTheme(nextTheme);
  };

  return (
    <div className="theme-switcher" role="group" aria-label="Color theme">
      {THEMES.map((option) => (
        <button
          key={option}
          className="theme-switcher__option"
          type="button"
          aria-label={`Use ${themeLabel(option)} theme`}
          aria-pressed={theme === option}
          onClick={() => pick(option)}
        >
          {themeLabel(option)}
        </button>
      ))}
      <span className="sr-only" aria-live="polite" aria-atomic="true">
        Theme: {themeLabel(theme)}
      </span>
    </div>
  );
}
