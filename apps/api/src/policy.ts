/**
 * Pharmacist standing authorization (DESIGN.md 7.4). Owner: P1 (the gate); P2 changes it from
 * iMessage replies. "Auto-file underpayments up to $X with complete evidence."
 */
import type { Claim, Evidence } from "@rxsolve/contracts";
import { getDb, type PolicyRecord } from "./db";

export async function getPolicy(pharmacyId: string): Promise<PolicyRecord> {
  return (await getDb().policy.get(pharmacyId)) ?? { pharmacy_id: pharmacyId, auto_file_max: 100, paused: false };
}

export async function setPolicy(p: PolicyRecord) {
  await getDb().policy.upsert(p);
}

export async function allows(claim: Claim, ev: Evidence): Promise<{ ok: boolean; why?: string }> {
  const p = await getPolicy(claim.pharmacy_id);
  if (p.paused) return { ok: false, why: "auto-filing paused by pharmacist" };
  if (ev.delta > p.auto_file_max)
    return { ok: false, why: `$${ev.delta.toFixed(2)} is over the $${p.auto_file_max} auto-file limit` };
  return { ok: true };
}
