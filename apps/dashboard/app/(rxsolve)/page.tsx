"use client";
/** Dashboard shell (UI-01). Owner: P3. Layout and shared selection only; panels live in components/panels/. */
import { AppHeader } from "@/components/AppHeader";
import { ClaimsPanel } from "@/components/panels/ClaimsPanel";
import { LedgerPanel } from "@/components/panels/LedgerPanel";
import { PharmacistPhone } from "@/components/panels/PharmacistPhone";
import { RecoveryChart } from "@/components/panels/RecoveryChart";
import { useLive } from "@/lib/live";

export default function Page() {
  const live = useLive();
  return (
    <div className="dashboard-shell">
      <AppHeader live={live} />
      <main className="dashboard-grid" aria-label="Live recovery operations">
        <div className="dashboard-col dashboard-col--fill">
          <ClaimsPanel live={live} />
          <PharmacistPhone />
        </div>
        <div className="dashboard-col">
          <RecoveryChart live={live} />
          <LedgerPanel live={live} />
        </div>
      </main>
    </div>
  );
}
