/**
 * Adjudication Watcher (AGT-01). Owner: P2.
 * Deterministic on CLEAR/UNDERWATER: no model call on those paths. MARGINAL is where judgment lives.
 * Delta is measured against acquisition cost, which is what the statutes entitle the pharmacy to
 * (DECISIONS.md 2026-10-10: not min(acq, nadac, contract)).
 */
import type { Claim, Verdict } from "@rxsolve/contracts";
import { deadlineFor } from "../deadlines";

export const MARGINAL_BAND = 0.5; // dollars

export async function adjudicate(claim: Claim): Promise<Verdict> {
  const base = { claim_id: claim.claim_id, benchmark_used: null, appeal_deadline: null, confidence: 1 };
  if (claim.acquisition_cost === null) return { ...base, verdict: "CLEAR", delta: 0 }; // no invoice: nothing to prove
  const delta = Math.round((claim.acquisition_cost - claim.paid_amount) * 100) / 100;
  if (delta <= 0) return { ...base, verdict: "CLEAR", delta: 0 };
  const deadline = deadlineFor(claim.state, claim.fill_date);
  if (delta <= MARGINAL_BAND) {
    // TODO(AGT-01): escalateToAgent(claim, delta) -> UNDERWATER or CLEAR with a reason.
    return { ...base, verdict: "MARGINAL", delta, benchmark_used: "acquisition_cost", appeal_deadline: deadline, confidence: 0.5 };
  }
  return { ...base, verdict: "UNDERWATER", delta, benchmark_used: "acquisition_cost", appeal_deadline: deadline, confidence: 0.97 };
}
