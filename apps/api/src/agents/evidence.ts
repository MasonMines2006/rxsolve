/**
 * Evidence Builder (AGT-02). Owner: P2.
 * STUB: builds the packet from fixtures. Still to do:
 *   - retrieve statute text and extract the entitlement with the agent model (agents/llm.ts)
 *   - render the real appeal PDF (invoice line + citation block) into out/
 */
import type { Claim, Evidence, Verdict } from "@rxsolve/contracts";
import { invoice, spec, statute } from "../reference";

function fieldsFor(claim: Claim): Record<string, unknown> {
  const inv = invoice(claim.ndc);
  return {
    state: claim.state,
    ndc: claim.ndc,
    rx_number: claim.ncpdp?.request["402-D2"] ?? null,
    fill_date: claim.fill_date,
    qty: claim.qty,
    paid_amount: claim.paid_amount,
    acquisition_cost: claim.acquisition_cost,
    invoice_number: inv?.invoice_number ?? null,
    invoice_date: inv?.invoice_date ?? null,
    wholesaler: inv?.wholesaler ?? null,
    wholesaler_attestation: inv?.wholesaler_attestation ?? null,
  };
}

export function score(fields: Record<string, unknown>, required: string[]) {
  const present = required.filter((f) => fields[f] !== null && fields[f] !== undefined && fields[f] !== "");
  return { present, completeness: required.length ? present.length / required.length : 1 };
}

export async function buildEvidence(claim: Claim, verdict: Verdict): Promise<Evidence> {
  const s = spec(claim.pbm);
  const law = statute(claim.state);
  const fields = fieldsFor(claim);
  const { present, completeness } = score(fields, s.required_fields);
  return {
    claim_id: claim.claim_id,
    statute: law.citation,
    entitlement: law.entitlement,
    attachments: [`wholesaler_invoice_${claim.claim_id}.pdf`], // TODO(AGT-02): real PDF
    required_fields_present: present,
    spec_version: s.version,
    completeness,
    fields,
    delta: verdict.delta,
    appeal_deadline: verdict.appeal_deadline,
  };
}

/** Add a fetched document (e.g. a wholesaler attestation) and rescore against our spec. */
export function withDocument(ev: Evidence, pbm: string, field: string, value: unknown): Evidence {
  const fields = { ...ev.fields, [field]: value };
  const { present, completeness } = score(fields, spec(pbm).required_fields);
  return { ...ev, fields, required_fields_present: present, completeness, attachments: [...ev.attachments, `${field}_${ev.claim_id}.pdf`] };
}
