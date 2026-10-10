/** Fax paper: cover sheet + evidence rendering, and text-layer extraction from PDFs (AGT-05). */
import type { Claim, Evidence } from "@rxsolve/contracts";
import { renderPdf } from "../agents/pdf";

const PAGE_LINES = 56;
const WRAP = 92;

/** Text lines from a PDF's content streams as written by renderPdf, in page order. */
export function pdfText(bytes: Uint8Array): string[] {
  const src = Buffer.from(bytes).toString("latin1");
  const out: string[] = [];
  for (const m of src.matchAll(/\(((?:\\.|[^\\)])*)\)\s*(?:'|Tj)/g)) out.push(m[1]!.replace(/\\([\\()])/g, "$1"));
  return out;
}

const short = (v: unknown) => String(v ?? "").replace(/\s+/g, " ").slice(0, 70);

export type CoverClaim = Pick<Claim, "claim_id" | "pbm" | "pharmacy_id" | "plan" | "state">;

export function coverLines(claim: CoverClaim, ev: Evidence, ticketId?: string, note?: string): string[] {
  const lines = [
    "FAX COVER SHEET: PHARMACY MAC APPEAL",
    "",
    `To: ${claim.pbm}   Appeals department`,
    `From: ${claim.pharmacy_id}   Reply to: RxSolve return line`,
    `Claim: ${claim.claim_id}   State: ${short(ev.fields.state ?? claim.state)}   Plan: ${short(claim.plan)}`,
    `Statute: ${short(ev.statute)}`,
    `Amount appealed: $${ev.delta.toFixed(2)}`,
    ticketId ? `RE: ticket ${ticketId} (additional documentation / rebuttal)` : "New appeal",
  ];
  if (note) lines.push(`Note: ${short(note)}`);
  lines.push("", "REQUIRED FIELDS");
  for (const [k, v] of Object.entries(ev.fields)) lines.push(`${k}: ${short(v)}`);
  lines.push("", `Attachments: ${ev.attachments.join(", ") || "none"}`);
  return lines.slice(0, PAGE_LINES);
}

/** One PDF: the cover sheet padded to a full page, then the evidence text pages. */
export function renderFax(cover: string[], evidenceLines: string[], title: string): Uint8Array {
  const pad = Array<string>(Math.max(0, PAGE_LINES - cover.length)).fill("");
  return renderPdf([...cover.map((l) => l.slice(0, WRAP)), ...pad, ...evidenceLines], title);
}
