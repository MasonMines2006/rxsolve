/**
 * Orchestrator (DESIGN.md section 9, INF-05). Owner: P1.
 * Performs no recovery action itself; it gates transitions and records them. Watcher first; Evidence
 * only on UNDERWATER; Filing only on complete evidence inside the standing policy; Negotiation only
 * on a denial; Settlement only on APPROVED.
 */
import { Claim, type Decision, type Outcome, type Stage, type Ticket } from "@rxsolve/contracts";
import { adapterFor, type ChannelAdapter } from "./adapters";
import { buildEvidence } from "./agents/evidence";
import { onDenial } from "./agents/negotiation";
import { raiseException } from "./agents/notifier";
import { adjudicate } from "./agents/watcher";
import { config } from "./config";
import { getDb } from "./db";
import { bus } from "./events";
import { getLedger } from "./ledger";
import { settleRecovery } from "./ledger/settle";
import { allows } from "./policy";

const MAX_ROUNDS = 3; // denial -> remediate -> refile cycles before escalating

async function stage(claimId: string, s: Stage, reason?: string) {
  await getDb().claims.patch(claimId, { stage: s, reason });
  await getDb().audit.insert({ claim_id: claimId, ts: new Date().toISOString(), stage: s, reason });
  bus.emit("claim.stage", claimId, { stage: s, reason });
}

async function done(claimId: string, s: Stage, delta = 0, reason?: string): Promise<Outcome> {
  await stage(claimId, s, reason);
  return { claim_id: claimId, stage: s, delta, reason };
}

export async function awaitResolution(adapter: ChannelAdapter, ticket: Ticket): Promise<Decision | null> {
  const giveUp = Date.now() + config.resolutionTimeoutMs;
  while (Date.now() < giveUp) {
    const d = await adapter.poll(ticket);
    if (d) return d;
    await Bun.sleep(config.pollIntervalMs);
  }
  return null;
}

export async function processClaim(claimId: string): Promise<Outcome> {
  const db = getDb();
  const claim = Claim.parse(await db.claims.get(claimId));

  if (!(await getLedger().hasAccount(claim.pharmacy_id))) return done(claimId, "ABANDONED", 0, "no_ledger_account"); // Gate 1

  const verdict = await adjudicate(claim); // Phase 1: no model on CLEAR/UNDERWATER
  await db.claims.patch(claimId, { verdict });
  bus.emit("verdict", claimId, verdict);
  if (verdict.verdict === "CLEAR") return done(claimId, "CLEARED");
  if (verdict.verdict === "MARGINAL") {
    // Until AGT-01's agent escalation lands, a human decides.
    await raiseException(claim, `marginal underpayment of $${verdict.delta.toFixed(2)}`);
    return done(claimId, "EXCEPTION", verdict.delta, "marginal");
  }
  await stage(claimId, "DETECTED");

  let evidence = await buildEvidence(claim, verdict); // Phase 2
  await db.evidence.upsert(evidence);
  bus.emit("evidence.built", claimId, evidence);
  await stage(claimId, "EVIDENCE");
  if (evidence.completeness < 1) {
    // Never file incomplete evidence.
    await raiseException(claim, `evidence incomplete (${Math.round(evidence.completeness * 100)}%)`);
    return done(claimId, "EXCEPTION", verdict.delta, "incomplete_evidence");
  }
  const policy = await allows(claim, evidence);
  if (!policy.ok) {
    bus.emit("exception.raised", claimId, { reason: policy.why!, ask: "APPROVE or SKIP" });
    await raiseException(claim, policy.why!);
    return done(claimId, "EXCEPTION", verdict.delta, policy.why);
  }

  const adapter = adapterFor(claim.pbm); // Phase 3: the PBM's own door
  let ticket = await adapter.submit(claim, evidence);
  await db.appeals.insert({ ...ticket, status: "FILED", deadline: verdict.appeal_deadline });
  bus.emit("appeal.filed", claimId, ticket);
  await stage(claimId, "FILED");

  for (let round = 0; round < MAX_ROUNDS; round++) {
    const decision = await awaitResolution(adapter, ticket); // Phase 4
    if (!decision) return done(claimId, "ESCALATED", verdict.delta, "no response before deadline");
    bus.emit("appeal.decision", claimId, decision);
    await db.appeals.patch(ticket.ticket_id, { status: decision.status, decision });
    if (decision.status === "APPROVED") {
      const delta = decision.delta ?? evidence.delta;
      await settleRecovery(claim, delta); // Phase 5
      return done(claimId, "SETTLED", delta);
    }
    await stage(claimId, "NEGOTIATING", decision.reason ?? undefined);
    const action = await onDenial(claim, evidence, decision, adapter, ticket);
    bus.emit("negotiation.action", claimId, action);
    if (action.kind !== "REFILED")
      return done(claimId, action.kind === "ABANDONED" ? "ABANDONED" : "ESCALATED", verdict.delta, action.reason);
    ticket = action.ticket!;
    evidence = action.evidence ?? evidence;
  }
  return done(claimId, "ESCALATED", verdict.delta, "too many denial rounds");
}

/** Background entry point: a crash on one claim never takes down the service. */
export async function processClaimSafe(claimId: string) {
  try {
    await processClaim(claimId);
  } catch (e) {
    console.error(`processClaim failed for ${claimId}`, e);
    await stage(claimId, "ESCALATED", `internal error: ${e}`);
  }
}
