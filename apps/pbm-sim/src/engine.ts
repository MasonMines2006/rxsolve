/** Decision engine (DESIGN.md 8.3, INF-06). Owner: P1. Deterministic: no model decides a concession. */
import { persona, requiredFields } from "./personas";

export type Decision = {
  status: "APPROVED" | "DENIED";
  reason?: "missing_field" | "insufficient_evidence" | "disputed";
  field?: string;
  delta?: number;
  message: string;
};

export function decide(pbm: string, state: string, fields: Record<string, unknown>, delta: number, round: number): Decision {
  const required = requiredFields(pbm, state);
  const missing = required.filter((f) => fields[f] === null || fields[f] === undefined || fields[f] === "");
  const completeness = 1 - missing.length / required.length;
  const p = persona(pbm);
  if (missing.length === 0) {
    if (p.deny_first_then_approve_on_rebuttal && round === 1) {
      // TODO(INF-06): deny as "disputed" first, concede on rebuttal (the phone-escalation path). Approves for now.
    }
    return { status: "APPROVED", delta: Math.round(delta * 100) / 100, message: `MAC appeal approved. Adjustment $${delta.toFixed(2)} will post on the next remittance.` };
  }
  if (completeness >= p.partial_threshold) {
    const field = missing[0]!;
    return { status: "DENIED", reason: "missing_field", field, message: `Appeal denied: required documentation missing (${field.replaceAll("_", " ")}).` };
  }
  return { status: "DENIED", reason: "insufficient_evidence", message: "Appeal denied: insufficient supporting documentation." };
}
