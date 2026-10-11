"use client";
/** Dashboard shell (UI-01). Owner: P3. Layout and shared selection only; panels live in components/panels/. */
import { useState } from "react";
import { AppHeader } from "@/components/AppHeader";
import { CashierTerminal } from "@/components/panels/CashierTerminal";
import { ChannelViewer } from "@/components/panels/ChannelViewer";
import { ClaimJourney } from "@/components/panels/ClaimJourney";
import { LedgerPanel } from "@/components/panels/LedgerPanel";
import { PharmacistPhone } from "@/components/panels/PharmacistPhone";
import { PipelineBoard } from "@/components/panels/PipelineBoard";
import { RecoveryChart } from "@/components/panels/RecoveryChart";
import { RecoveryFeed } from "@/components/panels/RecoveryFeed";
import { recoveryClaims } from "@/lib/claims";
import { useLive } from "@/lib/live";

export default function Page() {
  const live = useLive();
  const [pickedId, setPickedId] = useState<string | null>(null);

  // Until a row is picked the newest recovery claim is followed; a pick sticks.
  const claims = recoveryClaims(live);
  const selectedId = pickedId && live.claims[pickedId] ? pickedId : claims[0]?.claimId ?? null;

  return (
    <div className="dashboard-shell">
      <AppHeader live={live} />
      <main className="dashboard-grid" aria-label="Live recovery operations">
        <div className="dashboard-col">
          <CashierTerminal live={live} />
          <LedgerPanel live={live} />
        </div>
        <div className="dashboard-col">
          <RecoveryFeed live={live} selectedId={selectedId} onSelect={setPickedId} />
          <ClaimJourney live={live} selectedId={selectedId} />
        </div>
        <div className="dashboard-col">
          <RecoveryChart live={live} />
          <PharmacistPhone live={live} />
        </div>
      </main>
      <section className="dashboard-more" aria-label="Pipeline and channel history">
        <PipelineBoard live={live} />
        <ChannelViewer live={live} />
      </section>
    </div>
  );
}
