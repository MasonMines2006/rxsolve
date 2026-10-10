/**
 * Wholesaler Contact (part of AGT-06). Owner: P2.
 * STUB: the wholesaler "replies" instantly. Real path: messaging.send("whatsapp", WHOLESALER_CONTACT, ...)
 * and wait for the inbound reply (messaging/spectrum.ts routes it here).
 */
import type { Claim } from "@rxsolve/contracts";
import { record } from "../transcript";

export async function requestDocument(claim: Claim, field: string): Promise<string> {
  const what = field.replaceAll("_", " ");
  await record({
    claim_id: claim.claim_id, channel: "whatsapp", direction: "out", counterparty: "wholesaler",
    text: `Hi, this is RxSolve for ${claim.pharmacy_id}. Can you send the ${what} for NDC ${claim.ndc}?`,
  });
  const docId = `ATT-${claim.claim_id.replace(/^RXS-/, "")}`;
  await record({
    claim_id: claim.claim_id, channel: "whatsapp", direction: "in", counterparty: "wholesaler",
    text: `Attached: ${what} ${docId}`, attachments: [`${field}_${claim.claim_id}.pdf`],
  });
  return docId;
}
