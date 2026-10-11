"use client";
/** Live recovery feed (UI-03). Owner: P3. */
import { deadlineLabel, useDeadlineClock } from "@/lib/deadline";
import { type PanelProps, usd } from "./types";

export function RecoveryFeed({ live }: PanelProps) {
  const now = useDeadlineClock();
  const claimIds = [...new Set([...live.order, ...Object.keys(live.claims)])];
  const claims = claimIds.flatMap((claimId) => {
    const view = live.claims[claimId];
    return view ? [{ claimId, view }] : [];
  });
  const recoveries = claims.filter(({ view }) =>
    view.verdict && view.verdict.verdict !== "CLEAR" && view.stage !== "CLEARED",
  );
  const clearCount = claims.filter(({ view }) => view.verdict?.verdict === "CLEAR" || view.stage === "CLEARED").length;

  return (
    <section className="panel" aria-labelledby="recovery-feed-title">
      <h2 id="recovery-feed-title">Recovery feed</h2>
      <ul className="plain" aria-label="Claims requiring recovery">
        {recoveries.map(({ claimId, view }) => {
          const delta = view.verdict?.delta;
          const deltaLabel = typeof delta === "number" && Number.isFinite(delta) ? usd(delta) : "—";
          const status = view.stage ?? `${view.verdict!.verdict} · stage pending`;

          return (
            <li key={claimId}>
              <article className="panel" aria-label={`Recovery claim ${claimId}`}>
                <header style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
                  <div>
                    <h3>{view.claim.drug || "Drug unavailable"}</h3>
                    <p className="muted">{claimId}</p>
                  </div>
                  <span className="pill">{status}</span>
                </header>
                <dl style={{ display: "grid", gridTemplateColumns: "max-content minmax(0, 1fr)", gap: "4px 8px", margin: 0 }}>
                  <dt>Delta</dt>
                  <dd className="money" aria-label={deltaLabel === "—" ? "Delta unavailable" : `Delta ${deltaLabel}`} style={{ margin: 0 }}>{deltaLabel}</dd>
                  <dt>PBM</dt>
                  <dd style={{ margin: 0 }}>{view.claim.pbm || "PBM unavailable"}</dd>
                  <dt>Channel</dt>
                  <dd style={{ margin: 0 }}>{view.ticket?.channel ?? "Not filed"}</dd>
                  <dt>Deadline</dt>
                  <dd style={{ margin: 0 }}>{deadlineLabel(view.verdict?.appeal_deadline, now)}</dd>
                </dl>
              </article>
            </li>
          );
        })}
        {recoveries.length === 0 && (
          <li className="muted">
            {claims.length === 0
              ? "No claims received yet."
              : clearCount === claims.length
                ? "No recovery needed; clear claims are above cost."
                : "No non-clear verdicts yet."}
          </li>
        )}
      </ul>
    </section>
  );
}
