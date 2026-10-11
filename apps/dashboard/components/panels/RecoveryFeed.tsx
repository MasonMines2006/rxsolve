"use client";
/** Underpaid claims list (UI-03). Owner: P3. Selecting a row drives the claim journey panel. */
import { Panel } from "@/components/ui/Panel";
import { Pill } from "@/components/ui/Pill";
import { recoveryClaims, stageTone } from "@/lib/claims";
import { deadlineShort, deadlineUrgent, useDeadlineClock } from "@/lib/deadline";
import { type PanelProps, usd } from "./types";

type Props = PanelProps & { selectedId: string | null; onSelect: (claimId: string) => void };

export function RecoveryFeed({ live, selectedId, onSelect }: Props) {
  const now = useDeadlineClock();
  const claims = recoveryClaims(live);
  const total = Object.keys(live.claims).length;

  return (
    <Panel id="claims" title="Underpaid claims" aside={`${claims.length} open or settled`}>
      <ul className="plain claim-list" aria-label="Claims requiring recovery" aria-live="polite" aria-relevant="additions">
        {claims.map(({ claimId, view }) => {
          const settled = view.stage === "SETTLED";
          const deadline = view.verdict?.appeal_deadline;
          const urgent = !settled && deadlineUrgent(deadline, now);
          const delta = view.verdict?.delta;
          return (
            <li key={claimId}>
              <button
                type="button"
                className="row-button claim-row"
                aria-pressed={selectedId === claimId}
                onClick={() => onSelect(claimId)}
              >
                <span className="mono claim-row__id">{claimId}</span>
                <span>
                  <strong className="row-title">{view.claim.drug || "Drug unavailable"}</strong>
                  <small className="muted">{view.claim.pbm} · {view.ticket?.channel ?? "not filed"}</small>
                </span>
                <span className={`claim-row__delta money ${settled ? "tone-good" : "tone-bad"}`}>{usd(delta)}</span>
                <Pill tone={stageTone(view.stage)}>{view.stage ?? "PENDING"}</Pill>
                <span className={`mono claim-row__deadline ${urgent ? "tone-bad" : ""}`}>
                  {settled ? "Satisfied" : deadlineShort(deadline, now)}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      {claims.length === 0 && (
        <p className="empty">
          {total === 0
            ? "Nothing underpaid yet. Ring up a claim at the register."
            : "No recovery needed so far; every claim is at or above cost."}
        </p>
      )}
    </Panel>
  );
}
