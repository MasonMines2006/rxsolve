"use client";
/** The single list of claims read from the pharmacy's claim feed, newest first. Owner: P3. */
import Link from "next/link";
import { useMemo } from "react";
import { Panel } from "@/components/ui/Panel";
import { Pill } from "@/components/ui/Pill";
import { buildClaimRows, rowSummary } from "@/lib/claimRows";
import { deadlineShort, deadlineUrgent, useDeadlineClock } from "@/lib/deadline";
import { type PanelProps, usd } from "./types";

export function ClaimsPanel({ live }: PanelProps) {
  const now = useDeadlineClock();
  const rows = useMemo(() => buildClaimRows(live), [live]);

  return (
    <Panel id="claims" title="Claims" aside={`${rows.length} from the pharmacy's claim feed`}>
      <ul className="plain claims" aria-label="Claims">
        {rows.map((r) => {
          const { summary, label } = rowSummary(r, now);
          const urgent = !r.settled && !r.paidAtCost && deadlineUrgent(r.deadline ?? undefined, now);
          return (
            <li key={r.claimId} className={`claim-row${r.quiet ? " claim-row--quiet" : ""}`}>
              <span><Pill tone={r.pill.tone}>{r.pill.label}</Pill></span>
              <span>
                <strong className="row-title">{r.drug}</strong>
                <small className="muted">{summary}</small>
              </span>
              <span className={`claim-row__delta money ${r.settled ? "tone-good" : r.delta ? "tone-bad" : "muted"}`}>
                {r.paidAtCost ? "Paid fairly" : r.delta !== null ? usd(r.delta) : ""}
              </span>
              <span className={`mono ${urgent ? "tone-bad" : "muted"}`}>
                {r.settled ? "Satisfied" : r.deadline && !r.paidAtCost ? deadlineShort(r.deadline, now) : ""}
              </span>
              <span className="claim-row__actions">
                <Link className="claim-row__see" href={`/claims/${encodeURIComponent(r.claimId)}`} aria-label={`See status for ${label}`}>
                  See status
                </Link>
              </span>
            </li>
          );
        })}
      </ul>
      {rows.length === 0 && <p className="empty">No claims yet. They appear here as the pharmacy's system bills the PBM.</p>}
    </Panel>
  );
}
