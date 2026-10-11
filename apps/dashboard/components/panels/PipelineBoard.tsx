"use client";
/** Pipeline board (UI-03). Owner: P3. */
import type { Stage } from "@rxsolve/contracts";
import { deadlineLabel, useDeadlineClock } from "@/lib/deadline";
import { type PanelProps, usd } from "./types";

// CLEARED is intentionally omitted: those claims need no recovery and are not pipeline cards.
const COLUMNS: Stage[] = ["DETECTED", "EVIDENCE", "FILED", "NEGOTIATING", "SETTLED", "ESCALATED", "ABANDONED", "EXCEPTION"];

export function PipelineBoard({ live }: PanelProps) {
  const now = useDeadlineClock();
  const claimIds = [...new Set([...live.order, ...Object.keys(live.claims)])];
  const claims = claimIds.flatMap((claimId) => {
    const view = live.claims[claimId];
    return view ? [{ claimId, view }] : [];
  }).filter(({ view }) => view.verdict?.verdict !== "CLEAR" && view.stage !== "CLEARED");
  const columns: { stage?: Stage; label: string }[] = [
    { label: "Awaiting stage" },
    ...COLUMNS.map((stage) => ({ stage, label: stage })),
  ];

  return (
    <section className="panel" aria-labelledby="pipeline-title">
      <h2 id="pipeline-title">Pipeline</h2>
      <div role="region" aria-label="Pipeline board; scroll horizontally to view every stage" tabIndex={0} style={{ maxWidth: "100%", minWidth: 0, overflowX: "auto" }}>
        <div style={{ display: "grid", gap: 8, gridTemplateColumns: `repeat(${columns.length}, minmax(160px, 1fr))`, minWidth: "max-content" }}>
          {columns.map(({ stage, label }) => {
            const stageClaims = claims.filter(({ view }) => stage ? view.stage === stage : !view.stage);
            const headingId = stage ? `pipeline-${stage.toLowerCase()}` : "pipeline-awaiting-stage";

            return (
              <section key={stage ?? "awaiting-stage"} aria-labelledby={headingId}>
                <h3 id={headingId}>{label}</h3>
                <ul className="plain" aria-label={`Claims in ${label}`}>
                  {stageClaims.map(({ claimId, view }) => {
                    const delta = view.verdict?.delta;
                    const deltaLabel = typeof delta === "number" && Number.isFinite(delta) ? usd(delta) : "—";

                    return (
                      <li key={claimId}>
                        <article className="panel" aria-label={`Claim ${claimId}`}>
                          <h4>{claimId}</h4>
                          <p>{view.claim.drug || "Drug unavailable"}</p>
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
                  {stageClaims.length === 0 && <li className="muted">No claims</li>}
                </ul>
              </section>
            );
          })}
        </div>
      </div>
      <p className="muted">Clear claims do not need recovery and are omitted from the pipeline.</p>
    </section>
  );
}
