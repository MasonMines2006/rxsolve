"use client";
/** Dashboard shell (UI-01). Owner: P3. Layout only; each panel lives in components/panels/. */
import { ThemeSwitcher } from "@/components/ThemeSwitcher";
import { CashierTerminal } from "@/components/panels/CashierTerminal";
import { ChannelViewer } from "@/components/panels/ChannelViewer";
import { LedgerPanel } from "@/components/panels/LedgerPanel";
import { PharmacistPhone } from "@/components/panels/PharmacistPhone";
import { PipelineBoard } from "@/components/panels/PipelineBoard";
import { RecoveryChart } from "@/components/panels/RecoveryChart";
import { RecoveryFeed } from "@/components/panels/RecoveryFeed";
import { useLive } from "@/lib/live";

export default function Page() {
  const live = useLive();
  return (
    <main className="dashboard-shell">
      <header className="dashboard-header">
        <div className="dashboard-brand">
          <h1>RxSolve</h1>
          <p className="muted">Prescription recovery operations</p>
        </div>
        <p className={`dashboard-live ${live.connected ? "dashboard-live--connected" : "dashboard-live--reconnecting"}`} role="status" aria-live="polite">
          <span className="dashboard-live__indicator" aria-hidden="true" />
          {live.connected ? "Live stream connected" : "Connecting to live stream…"}
        </p>
        <ThemeSwitcher />
      </header>
      <section className="dashboard-primary-grid" aria-label="Live recovery operations">
        <CashierTerminal live={live} />
        <RecoveryFeed live={live} />
        <LedgerPanel live={live} />
        <RecoveryChart live={live} />
      </section>
      <PipelineBoard live={live} />
      <section className="dashboard-secondary-grid" aria-label="Channel and pharmacist communications">
        <ChannelViewer live={live} />
        <PharmacistPhone live={live} />
      </section>
    </main>
  );
}
