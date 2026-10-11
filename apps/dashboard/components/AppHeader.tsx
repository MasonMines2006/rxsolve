import { Hero } from "@/components/Hero";
import { ThemeSwitcher } from "@/components/ThemeSwitcher";
import { ReleaseAll } from "@/components/status/HoldControls";
import type { PanelProps } from "@/components/panels/types";

function Logo() {
  return (
    <svg className="brand__logo" width="56" height="56" viewBox="0 0 64 64" aria-hidden="true">
      <circle cx="32" cy="32" r="29" fill="none" stroke="currentColor" strokeWidth="5" />
      <path d="M18 33 L28 43 L47 21" fill="none" stroke="currentColor" strokeWidth="7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** Brand, recovered-to-date hero, live stream status and theme switcher. */
export function AppHeader({ live }: PanelProps) {
  return (
    <header className="app-header">
      <div className="brand">
        <Logo />
        <div>
          <h1 className="brand__name">RxSolve</h1>
          <p className="brand__sub">Meadowbrook Pharmacy</p>
        </div>
      </div>
      <Hero live={live} />
      <div className="app-header__controls">
        <p className={`live-status ${live.connected ? "live-status--on" : "live-status--off"}`} role="status" aria-live="polite">
          <span className="live-status__dot" aria-hidden="true" />
          {live.connected ? "Live stream connected" : "Connecting to live stream…"}
        </p>
        <ThemeSwitcher />
        <ReleaseAll />
      </div>
    </header>
  );
}
