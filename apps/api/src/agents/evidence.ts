/**
 * Evidence Builder (AGT-02). Owner: P2.
 * Entitlement text comes from the agent model when a key is set (fixture text otherwise), the PDFs are
 * rendered locally into out/evidence/, and completeness is scored against the PBM spec plus state extras.
 */
import type { Claim, Evidence, Verdict } from "@rxsolve/contracts";
import { invoice, spec, statute } from "../reference";
import { resolveEntitlement, type Ask } from "./entitlement";
import { appealPdf, EVIDENCE_DIR, invoicePdf, writePacket } from "./packet";

export type StateRules = Record<string, string[]>;
export type BuildOpts = { ask?: Ask; outDir?: string; stateRules?: StateRules };

/** Extra fields our spec knows a PBM enforces for a state; specs.json may carry `state_rules`. */
export function requiredFor(pbm: string, state: string, stateRules?: StateRules): string[] {
  const s = spec(pbm) as { required_fields: string[]; state_rules?: StateRules };
  const extra = (stateRules ?? s.state_rules ?? {})[state] ?? [];
  return [...new Set([...s.required_fields, ...extra])];
}

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

function windowText(state: string): string {
  const w = statute(state) as { window_business_days: number; window_calendar_days?: number };
  return w.window_calendar_days
    ? `${w.window_calendar_days} calendar days (at least ${w.window_business_days} business days)`
    : `${w.window_business_days} business days`;
}

export async function buildEvidence(claim: Claim, verdict: Verdict, opts: BuildOpts = {}): Promise<Evidence> {
  const s = spec(claim.pbm);
  const ent = await resolveEntitlement(claim.state, opts.ask);
  const fields = fieldsFor(claim);
  const required = requiredFor(claim.pbm, claim.state, opts.stateRules);
  const { present, completeness } = score(fields, required);
  const inv = invoice(claim.ndc);

  const input = {
    claim, verdict, invoice: inv, citation: ent.citation, entitlement: ent.entitlement,
    windowText: windowText(claim.state), present, missing: required.filter((f) => !present.includes(f)),
    specVersion: s.version, pbm: claim.pbm,
  };
  const names = await writePacket(opts.outDir ?? EVIDENCE_DIR, claim.claim_id, invoicePdf(input), appealPdf(input));

  return {
    claim_id: claim.claim_id,
    statute: ent.citation,
    entitlement: ent.entitlement,
    attachments: inv ? [names.invoice, names.appeal] : [names.appeal], // no invoice line, no invoice attachment
    required_fields_present: present,
    spec_version: s.version,
    completeness,
    fields,
    delta: verdict.delta,
    appeal_deadline: verdict.appeal_deadline,
  };
}

/** Add a fetched document (e.g. a wholesaler attestation) and rescore against our spec. */
export function withDocument(ev: Evidence, pbm: string, field: string, value: unknown, stateRules?: StateRules): Evidence {
  const fields = { ...ev.fields, [field]: value };
  const { present, completeness } = score(fields, requiredFor(pbm, String(fields.state ?? ""), stateRules));
  return { ...ev, fields, required_fields_present: present, completeness, attachments: [...ev.attachments, `${field}_${ev.claim_id}.pdf`] };
}
