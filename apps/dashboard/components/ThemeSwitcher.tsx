"use client";
/** Header theme control (UI-07). Owner: P3. Persists per viewer; flips live without reload. */
import { useEffect, useState } from "react";

const THEMES = ["dark", "light", "aero"] as const;
type Theme = (typeof THEMES)[number];

export function ThemeSwitcher() {
  const [theme, setTheme] = useState<Theme>("dark");
  useEffect(() => setTheme((document.documentElement.dataset.theme as Theme) || "dark"), []);
  const pick = (t: Theme) => {
    document.documentElement.dataset.theme = t;
    try { localStorage.setItem("rxsolve-theme", t); } catch {}
    setTheme(t);
  };
  return (
    <div role="group" aria-label="Theme" style={{ display: "flex", gap: 6 }}>
      {THEMES.map((t) => (
        <button key={t} aria-pressed={theme === t} onClick={() => pick(t)}>
          {t === "aero" ? "Frutiger Aero" : t[0]!.toUpperCase() + t.slice(1)}
        </button>
      ))}
    </div>
  );
}
