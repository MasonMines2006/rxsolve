/**
 * Adjudication Watcher (AGT-01). Owner: P2.
 * Deterministic on CLEAR/UNDERWATER: no model call on those paths. MARGINAL is where judgment lives.
 * Delta is measured against acquisition cost, which is what the statutes entitle the pharmacy to
 * (DECISIONS.md 2026-10-10: not min(acq, nadac, contract)).
 */
import type { Claim, Verdict } from "@rxsolve/contracts";
import { z } from "zod";
import { config } from "../config";
import { deadlineFor } from "../deadlines";
import { extract } from "./llm";

export const MARGINAL_BAND = 0.5; // dollars

const MarginalCall = z.object({ verdict: z.enum(["UNDERWATER", "CLEAR"]), reason: z.string() });
type Extract = <T extends z.ZodType>(schema: T, prompt: string) => Promise<z.infer<T>>;

/** Resolves a MARGINAL claim with the agent; null (stay MARGINAL) with no key or on any model error. */
async function resolveMarginal(claim: Claim, delta: number, ask: Extract): Promise<"UNDERWATER" | "CLEAR" | null> {
  if (!config.agentApiKey) return null;
  const prompt = [
    "A pharmacy claim was paid slightly below acquisition cost. Decide whether it is worth appealing as UNDERWATER or CLEAR (rounding or immaterial).",
    `delta=${delta} pbm=${claim.pbm} state=${claim.state} plan=${claim.plan} qty=${claim.qty}`,
    `nadac=${claim.nadac} contract_rate=${claim.contract_rate} acquisition_cost=${claim.acquisition_cost} paid_amount=${claim.paid_amount}`,
  ].join("\n");
  try {
    return (await ask(MarginalCall, prompt)).verdict;
  } catch {
    return null;
  }
}

export async function adjudicate(claim: Claim, ask: Extract = extract): Promise<Verdict> {
  const base = { claim_id: claim.claim_id, benchmark_used: null, appeal_deadline: null, confidence: 1 };
  if (claim.acquisition_cost === null) return { ...base, verdict: "CLEAR", delta: 0 }; // no invoice: nothing to prove
  const delta = Math.round((claim.acquisition_cost - claim.paid_amount) * 100) / 100;
  if (delta <= 0) return { ...base, verdict: "CLEAR", delta: 0 };
  const deadline = deadlineFor(claim.state, claim.fill_date);
  if (delta <= MARGINAL_BAND) {
    const call = await resolveMarginal(claim, delta, ask);
    if (call === "CLEAR") return { ...base, verdict: "CLEAR", delta: 0, confidence: 0.8 };
    if (call === "UNDERWATER") return { ...base, verdict: "UNDERWATER", delta, benchmark_used: "acquisition_cost", appeal_deadline: deadline, confidence: 0.8 };
    return { ...base, verdict: "MARGINAL", delta, benchmark_used: "acquisition_cost", appeal_deadline: deadline, confidence: 0.5 };
  }
  return { ...base, verdict: "UNDERWATER", delta, benchmark_used: "acquisition_cost", appeal_deadline: deadline, confidence: 0.97 };
}
