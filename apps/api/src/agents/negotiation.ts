/**
 * Negotiation (AGT-06). Owner: P2.
 * Called by the orchestrator on each denial. Missing field: ask the wholesaler, rebuild the packet
 * with the real document, refile. Disputed with complete evidence: one rebuttal, then escalate.
 * Attempts per claim are bounded and the loop stops at the appeal deadline. Models only word text.
 */
import type { Action, Claim, Decision, Evidence, Ticket } from "@rxsolve/contracts";
import type { ChannelAdapter } from "../adapters";
import type { Ask } from "./entitlement";
import { rebuildWithDocument, requiredFor, type BuildOpts } from "./evidence";
import { fieldFromRaw, rebuttalText } from "./negotiation-text";
import { raiseException } from "./notifier";
import { requestDocument, wholesalerConfig, type WholesalerOpts } from "./wholesaler";

export const MAX_REMEDIATIONS = 2;
export const MAX_REBUTTALS = 1;

export type NegotiationOpts = { ask?: Ask; now?: Date; wholesaler?: WholesalerOpts; build?: BuildOpts };

const attempts = new Map<string, { remediate: number; rebut: number }>();
const tally = (id: string) => attempts.get(id) ?? attempts.set(id, { remediate: 0, rebut: 0 }).get(id)!;

export function resetNegotiation() {
  attempts.clear();
}

/** appeal_deadline is a calendar date; the whole day counts. */
export function windowClosed(deadline: string | null, now: Date): boolean {
  return deadline !== null && now.getTime() > Date.parse(`${deadline}T23:59:59Z`);
}

async function abandon(claim: Claim, reason: string): Promise<Action> {
  try {
    await raiseException(claim, `abandoned: ${reason}`);
  } catch (e) {
    console.warn("negotiation: exception ping failed", e);
  }
  return { kind: "ABANDONED", reason };
}

async function remediate(claim: Claim, ev: Evidence, field: string, adapter: ChannelAdapter, ticket: Ticket, o: NegotiationOpts): Promise<Action> {
  const t = tally(claim.claim_id);
  if (t.remediate >= MAX_REMEDIATIONS) return abandon(claim, `still missing ${field} after ${t.remediate} wholesaler requests`);
  t.remediate++;
  const timeoutMs = ev.appeal_deadline
    ? Math.max(0, Date.parse(`${ev.appeal_deadline}T23:59:59Z`) - (o.now ?? new Date()).getTime())
    : undefined;
  const wopts = { ...o.wholesaler, ask: o.wholesaler?.ask ?? o.ask };
  if (timeoutMs !== undefined) wopts.timeoutMs = Math.min(wopts.timeoutMs ?? wholesalerConfig.timeoutMs, timeoutMs);
  const doc = await requestDocument(claim, field, wopts);
  if (!doc) return abandon(claim, `wholesaler did not supply ${field}`);

  const evidence = await rebuildWithDocument(claim, ev, doc, o.build);
  if (evidence.completeness < 1 || evidence.fields[field] == null) return abandon(claim, `evidence incomplete after ${field}`);
  const next = await adapter.reply(ticket, { evidence, note: `Refiled with ${field.replaceAll("_", " ")}` });
  return { kind: "REFILED", ticket: next, evidence };
}

export async function onDenial(
  claim: Claim, ev: Evidence, denial: Decision, adapter: ChannelAdapter, ticket: Ticket, opts: NegotiationOpts = {},
): Promise<Action> {
  const now = opts.now ?? new Date();
  if (denial.reason === "window_expired") return { kind: "EXTERNAL_APPEAL", reason: "appeal window expired" };
  if (windowClosed(ev.appeal_deadline, now)) return { kind: "EXTERNAL_APPEAL", reason: "appeal deadline passed before refile" };

  if (denial.reason === "missing_field") {
    const field = denial.field ?? (await fieldFromRaw(denial.raw, requiredFor(claim.pbm, claim.state), opts.ask));
    if (!field) return abandon(claim, "denial did not name the missing field");
    return remediate(claim, ev, field, adapter, ticket, opts);
  }

  if (denial.reason === "disputed") {
    if (ev.completeness < 1) return abandon(claim, "disputed and evidence incomplete");
    const t = tally(claim.claim_id);
    if (t.rebut >= MAX_REBUTTALS) return { kind: "ESCALATED", reason: "disputed after rebuttal, supervisor review" };
    t.rebut++;
    const note = await rebuttalText(ev, denial, opts.ask);
    const next = await adapter.reply(ticket, { evidence: ev, note });
    return { kind: "REFILED", ticket: next, evidence: ev };
  }

  return abandon(claim, denial.reason ?? "unknown denial");
}
