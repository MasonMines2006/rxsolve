"use client";
/** Dashboard shell (UI-01). Owner: P3. Layout only; each panel lives in components/panels/. */
import { ThemeSwitcher } from "@/components/ThemeSwitcher";
import { CashierTerminal } from "@/components/panels/CashierTerminal";
import { ChannelViewer } from "@/components/panels/ChannelViewer";
import { LedgerPanel } from "@/components/panels/LedgerPanel";
import { PharmacistPhone } from "@/components/panels/PharmacistPhone";
import { PipelineBoard } from "@/components/panels/PipelineBoard";
import { RecoveryFeed } from "@/components/panels/RecoveryFeed";
import { useLive } from "@/lib/live";

export default function Page() {
  const live = useLive();
  return (
    <main style={{ padding: 16, display: "grid", gap: 12 }}>
      <header style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <strong style={{ fontSize: 20 }}>RxSolve</strong>
        <span className="pill">{live.connected ? "live" : "connecting…"}</span>
        <div style={{ marginLeft: "auto" }}><ThemeSwitcher /></div>
      </header>
      <section style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))" }}>
        <CashierTerminal live={live} />
        <RecoveryFeed live={live} />
        <LedgerPanel live={live} />
      </section>
      <PipelineBoard live={live} />
      <section style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))" }}>
        <ChannelViewer live={live} />
        <PharmacistPhone live={live} />
      </section>
    </main>
  );
}
