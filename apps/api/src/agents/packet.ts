/** Appeal packet PDFs (AGT-02): the 810-style invoice line and the appeal letter with citation and claim facts. */
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { Claim, Verdict } from "@rxsolve/contracts";
import { drugName, type InvoiceLine } from "../reference";
import { renderPdf } from "./pdf";

export const EVIDENCE_DIR = "out/evidence";
const usd = (n: number | null | undefined) => (n == null ? "n/a" : `$${n.toFixed(2)}`);

export type PacketInput = {
  claim: Claim;
  verdict: Verdict;
  invoice: InvoiceLine | undefined;
  citation: string;
  entitlement: string;
  windowText: string;
  present: string[];
  missing: string[];
  specVersion: string;
  pbm: string;
};

function invoiceLines(p: PacketInput): string[] {
  const { claim, invoice } = p;
  if (!invoice) return ["No wholesaler invoice line on file for this NDC."];
  const ext = Math.round(invoice.unit_cost * claim.qty * 100) / 100;
  return [
    `Invoice ${invoice.invoice_number}   Date ${invoice.invoice_date}   Wholesaler ${invoice.wholesaler}`,
    `NDC ${claim.ndc}   ${drugName(claim.ndc)}`,
    `Qty ${claim.qty}   Unit cost ${invoice.unit_cost}   Extended ${usd(ext)}`,
    `Wholesaler attestation: ${invoice.wholesaler_attestation ?? "not on file"}`,
  ];
}

export function invoicePdf(p: PacketInput): Uint8Array {
  return renderPdf(["WHOLESALER INVOICE LINE (X12 810 style)", "", ...invoiceLines(p)], `Invoice ${p.claim.claim_id}`);
}

export function appealPdf(p: PacketInput): Uint8Array {
  const { claim, verdict } = p;
  const lines = [
    `MAC APPEAL: claim ${claim.claim_id}`,
    `To: ${p.pbm} (spec ${p.specVersion})`,
    `From pharmacy: ${claim.pharmacy_id}   State: ${claim.state}   Plan: ${claim.plan}`,
    "",
    "AUTHORITY",
    `Citation: ${p.citation}`,
    `Entitlement: ${p.entitlement}`,
    `Appeal window: ${p.windowText}`,
    "",
    "CLAIM FACTS",
    `Rx number: ${claim.ncpdp?.request["402-D2"] ?? "n/a"}   Patient ref: ${claim.patient_ref}`,
    `NDC ${claim.ndc} ${drugName(claim.ndc)}   Qty ${claim.qty}   Fill date ${claim.fill_date}`,
    `Paid ${usd(claim.paid_amount)}   Acquisition cost ${usd(claim.acquisition_cost)}   Underpayment ${usd(verdict.delta)}`,
    `Appeal deadline: ${verdict.appeal_deadline ?? "n/a"}`,
    "",
    "ATTACHED INVOICE LINES",
    ...invoiceLines(p),
    "",
    "REQUIRED FIELDS",
    `Present: ${p.present.join(", ") || "none"}`,
    p.missing.length ? `MISSING (not ready to file): ${p.missing.join(", ")}` : "Missing: none",
  ];
  return renderPdf(lines, `Appeal ${claim.claim_id}`);
}

export async function writePacket(dir: string, claimId: string, invoice: Uint8Array, appeal: Uint8Array) {
  await mkdir(dir, { recursive: true });
  const names = { invoice: `wholesaler_invoice_${claimId}.pdf`, appeal: `appeal_${claimId}.pdf` };
  await Bun.write(join(dir, names.invoice), invoice);
  await Bun.write(join(dir, names.appeal), appeal);
  return names;
}
