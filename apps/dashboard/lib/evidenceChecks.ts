/** Honest evidence checklist: ticks only what is verified, otherwise says what is missing or unverified. Owner: P3. Pure. */
import type { ChannelMessage } from "@rxsolve/contracts";
import { plainField } from "./plain";
import type { ClaimView } from "./state";

export type Probe = "ok" | "missing" | "unverified";
export type Probes = Record<string, Probe | undefined>;
export type EvidenceCheck = { label: string; tone: "good" | "bad" | "muted"; state: string };

const PBM_CHANNELS = new Set(["portal", "email", "fax"]);
export const INVOICE_PREFIX = "wholesaler_invoice_";

export const cite = (s: string, max = 44) => (s.length > max ? `${s.slice(0, max - 1).trimEnd()}...` : s);

/** Names the status screen should probe for existence. */
export function probeNames(view: ClaimView): string[] {
  return (view.evidence?.attachments ?? []).filter((a) => a.startsWith(INVOICE_PREFIX));
}

export function evidenceChecks(view: ClaimView, messages: readonly ChannelMessage[], probes: Probes): EvidenceCheck[] {
  const ev = view.evidence;
  const out: EvidenceCheck[] = [];

  const invoice = probeNames(view)[0];
  if (!invoice) out.push({ label: "Invoice not attached", tone: "bad", state: "invoice-none" });
  else {
    const p = probes[invoice];
    if (p === "ok") out.push({ label: "✓ Invoice attached", tone: "good", state: "invoice-ok" });
    else if (p === "missing") out.push({ label: "Invoice not available (stub)", tone: "muted", state: "invoice-stub" });
    else if (p === "unverified") out.push({ label: "Invoice unverified", tone: "muted", state: "invoice-unverified" });
    else out.push({ label: "Checking invoice...", tone: "muted", state: "invoice-pending" });
  }

  out.push(ev?.statute
    ? { label: `✓ State law: ${cite(ev.statute)}`, tone: "good", state: "law-cited" }
    : { label: "State law not cited", tone: "muted", state: "law-none" });

  const mine = messages.filter((m) => m.claim_id === view.claim.claim_id);
  const denial = [...view.decisions].reverse().find((d) => d.status === "DENIED" && d.reason === "missing_field" && d.field);
  if (denial?.field) {
    const what = plainField(denial.field);
    const filedAgain = mine.filter((m) => m.direction === "out" && PBM_CHANNELS.has(m.channel) && m.counterparty !== "wholesaler")
      .slice(1)
      .some((m) => m.attachments.some((a) => a.startsWith(`${denial.field}_`)));
    const asked = mine.some((m) => m.direction === "out" && m.counterparty === "wholesaler");
    if (filedAgain) out.push({ label: `✓ ${cap(what)} supplied`, tone: "good", state: "paper-supplied" });
    else if (asked) out.push({ label: `Asked the wholesaler for the ${what.replace(/ from the wholesaler$/, "")}`, tone: "muted", state: "paper-requested" });
    else out.push({ label: `✗ Missing ${what}`, tone: "bad", state: "paper-missing" });
  } else {
    const complete = (ev?.completeness ?? 0) >= 1;
    out.push({ label: complete ? "✓ Matches the PBM checklist" : "PBM checklist incomplete", tone: complete ? "good" : "muted", state: complete ? "checklist-ok" : "checklist-incomplete" });
  }
  return out;
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
