/**
 * Claim feed from the PBM Sim switch -> Claim (DESIGN.md 5.3). Owner: P1.
 * Flat fields come from the NCPDP-shaped message; cost references come from our own reference
 * data, never from the claim message.
 */
import { z } from "zod";
import { Claim, NCPDP, PBM } from "@rxsolve/contracts";
import { contractUnit, invoice, nadacUnit } from "./reference";

/** Body of POST /api/feed/claim, sent by apps/pbm-sim/src/switch.ts. P1-internal HTTP contract. */
export const SwitchFeed = z.object({
  meta: z.object({
    claim_id: z.string().optional(),
    pbm: PBM,
    pharmacy_id: z.string(),
    state: z.string(),
    plan: z.string(),
    patient_ref: z.string(),
  }),
  ncpdp: NCPDP,
});
export type SwitchFeed = z.infer<typeof SwitchFeed>;

const money = (x: number | undefined) => (x === undefined ? null : Math.round(x * 100) / 100);

export function toClaim(feed: SwitchFeed): Claim {
  const req = feed.ncpdp.request as Record<string, string | number>;
  const resp = (feed.ncpdp.response ?? {}) as Record<string, number | null>;
  const ndc = String(req["407-D7"]);
  const qty = Number(req["442-E7"]);
  const dos = String(req["401-D1"]);
  const inv = invoice(ndc);
  const nadac = nadacUnit(ndc);
  const contract = contractUnit(feed.meta.plan, ndc);
  return Claim.parse({
    claim_id: feed.meta.claim_id ?? `RXS-${req["402-D2"]}`,
    pharmacy_id: feed.meta.pharmacy_id,
    pbm: feed.meta.pbm,
    state: feed.meta.state,
    plan: feed.meta.plan,
    patient_ref: feed.meta.patient_ref,
    ndc,
    qty,
    fill_date: `${dos.slice(0, 4)}-${dos.slice(4, 6)}-${dos.slice(6, 8)}`,
    paid_amount: Number(resp["509-F9"] ?? 0),
    acquisition_cost: money(inv && inv.unit_cost * qty),
    nadac: money(nadac === undefined ? undefined : nadac * qty),
    contract_rate: money(contract === undefined ? undefined : contract * qty),
    ncpdp: feed.ncpdp,
  });
}
