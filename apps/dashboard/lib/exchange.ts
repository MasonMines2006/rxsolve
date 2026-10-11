/** Whole-claim channel transcript and raw-field list for the status screen. Owner: P3. Pure. */
import type { ChannelMessage } from "@rxsolve/contracts";
import type { ClaimView } from "./state";

/** Every channel message for one claim (portal, email, fax, wholesaler, phone) in time order. */
export function exchangeFor(claimId: string, ...lists: (readonly ChannelMessage[])[]): ChannelMessage[] {
  return lists.flat().filter((m) => m.claim_id === claimId).sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts));
}

/** Raw claim facts for the Details disclosure; the only place the claim id is rendered. */
export function rawFields(view: ClaimView): [string, string][] {
  const { claim } = view;
  return [
    ["Claim id", claim.claim_id],
    ["Patient reference", claim.patient_ref ?? "—"],
    ["Transaction", claim.ncpdp?.transaction ?? "—"],
    ...Object.entries(claim.ncpdp?.request ?? {}).map(([k, v]) => [`Request ${k}`, String(v)] as [string, string]),
    ...Object.entries(claim.ncpdp?.response ?? {}).map(([k, v]) => [`Response ${k}`, String(v)] as [string, string]),
    ["State", claim.state],
    ["Spec version", view.evidence?.spec_version ?? "—"],
  ];
}
