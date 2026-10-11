/** Plain-language names for internal enum values, so no raw field or reason code reaches a pharmacist. Owner: P3. */
const FIELD: Record<string, string> = {
  wholesaler_attestation: "signed statement from the wholesaler",
  invoice_number: "invoice number",
  invoice_date: "invoice date",
  acquisition_cost: "drug cost",
};
const REASON: Record<string, string> = {
  missing_field: "missing paper",
  insufficient_evidence: "not enough proof",
  disputed: "disputed",
  window_expired: "appeal window expired",
  not_eligible: "not eligible",
};
const ACTION: Record<string, string> = {
  REFILED: "filed again",
  ESCALATED: "escalated",
  EXTERNAL_APPEAL: "sent to an outside appeal",
  ABANDONED: "given up",
};

export const plainField = (f: string) => FIELD[f] ?? f.replaceAll("_", " ");
export const plainReason = (r: string) => REASON[r] ?? r.replaceAll("_", " ");
export const plainAction = (a: string) => ACTION[a] ?? a.toLowerCase().replaceAll("_", " ");

const STAGE: Record<string, string> = {
  DETECTED: "Found", EVIDENCE: "Building proof", FILED: "Filed", NEGOTIATING: "Negotiating",
  SETTLED: "Recovered", ESCALATED: "Escalated", ABANDONED: "Given up", EXCEPTION: "Needs you", CLEARED: "Paid fairly",
};
export const stageLabel = (stage: string | undefined) => (stage ? (STAGE[stage] ?? stage) : "Pending");
