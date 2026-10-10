/**
 * Pharmacist standing authorization (DESIGN.md 7.4). Owner: P1 (the gate); P2 changes it from
 * iMessage replies. "Auto-file underpayments up to $X with complete evidence."
 */
import type { Claim, Evidence } from "@rxsolve/contracts";
import { getDb, type PolicyRecord } from "./db";

/** `approved_claims` holds one-off pharmacist approvals (APPROVE <claim>) that bypass the limit and pause. */
export type PolicyDoc = PolicyRecord & { approved_claims?: string[] };

export async function getPolicy(pharmacyId: string): Promise<PolicyDoc> {
  return (await getDb().policy.get(pharmacyId)) ?? { pharmacy_id: pharmacyId, auto_file_max: 100, paused: false };
}

export async function setPolicy(p: PolicyDoc) {
  await getDb().policy.upsert(p);
}

export async function approveClaim(pharmacyId: string, claimId: string) {
  const p = await getPolicy(pharmacyId);
  const approved = new Set(p.approved_claims ?? []);
  approved.add(claimId);
  await setPolicy({ ...p, approved_claims: [...approved] });
}

export async function allows(claim: Claim, ev: Evidence): Promise<{ ok: boolean; why?: string }> {
  const p = await getPolicy(claim.pharmacy_id);
  if (p.approved_claims?.includes(claim.claim_id)) return { ok: true };
  if (p.paused) return { ok: false, why: "auto-filing paused by pharmacist" };
  if (ev.delta > p.auto_file_max)
    return { ok: false, why: `$${ev.delta.toFixed(2)} is over the $${p.auto_file_max} auto-file limit` };
  return { ok: true };
}
