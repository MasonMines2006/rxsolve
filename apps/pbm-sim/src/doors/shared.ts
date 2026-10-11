import { decide, type Decision } from "../engine";
import { delayMs, persona } from "../personas";
import { appeals, nextTicket, type Appeal } from "../store";

export type AppealDraft = Pick<Appeal, "claim_id" | "pbm" | "state" | "channel" | "fields" | "attachments" | "delta">;

export function isKnownPbm(pbm: string): boolean {
  try {
    persona(pbm);
    return true;
  } catch {
    return false;
  }
}

export function createAppeal(draft: AppealDraft): Appeal {
  const now = Date.now();
  const appeal: Appeal = {
    ...draft,
    ticket_id: nextTicket(persona(draft.pbm).ticket_prefix),
    submitted_at: new Date(now).toISOString(),
    decide_at: now + delayMs(draft.pbm),
    round: 1,
    decision: null,
    history: [],
  };
  appeals.set(appeal.ticket_id, appeal);
  return appeal;
}

export function refileAppeal(appeal: Appeal, draft: Pick<AppealDraft, "state" | "fields" | "attachments" | "delta">): Appeal {
  appeal.history.push({ round: appeal.round, decision: appeal.decision });
  appeal.state = draft.state;
  appeal.fields = draft.fields;
  appeal.attachments = draft.attachments;
  appeal.delta = draft.delta;
  appeal.submitted_at = new Date().toISOString();
  appeal.decide_at = Date.now() + delayMs(appeal.pbm);
  appeal.round += 1;
  appeal.decision = null;
  return appeal;
}

export function decisionFor(appeal: Appeal): Decision | null {
  if (appeal.decision) return appeal.decision;
  if (Date.now() < appeal.decide_at) return null;
  appeal.decision = decide(appeal.pbm, appeal.state, appeal.fields, appeal.delta, appeal.round);
  return appeal.decision;
}

export function ticketView(appeal: Appeal) {
  return {
    ticket_id: appeal.ticket_id,
    submitted_at: appeal.submitted_at,
    expected_response_by: new Date(appeal.decide_at).toISOString(),
  };
}

export function escapeHtml(value: unknown): string {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[char]!);
}

export function normalizeFieldName(value: string): string {
  return value.trim().toLowerCase().replace(/[\s-]+/g, "_");
}
