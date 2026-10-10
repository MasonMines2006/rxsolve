"use client";
/** Live recovery feed (UI-03). Owner: P3. TODO(UI-03): cards with drug, delta, PBM, channel, deadline countdown. */
import { type PanelProps, usd } from "./types";

export function RecoveryFeed({ live }: PanelProps) {
  const flagged = live.order.map((id) => live.claims[id]!).filter((c) => c.verdict && c.verdict.verdict !== "CLEAR");
  return (
    <div className="panel">
      <h2>Recovery feed</h2>
      <ul className="plain">
        {flagged.map((c) => (
          <li key={c.claim.claim_id}>
            {c.claim.claim_id} · {c.claim.drug} · <span className="money">{usd(c.verdict?.delta)}</span> · {c.claim.pbm} ·{" "}
            <span className="pill">{c.stage}</span>
          </li>
        ))}
        {flagged.length === 0 && <li className="muted">No underpaid claims yet. Run `bun seed`.</li>}
      </ul>
    </div>
  );
}
