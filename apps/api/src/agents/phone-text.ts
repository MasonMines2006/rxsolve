/**
 * Phone wording (AGT-08). Owner: P2.
 * Models only word the spoken statute citation and read the rep's transcript. They never decide
 * whether the PBM concedes; every model answer is checked against held facts, else a template runs.
 */
import { z } from "zod";
import type { Evidence } from "@rxsolve/contracts";
import type { Ask } from "./entitlement";
import { modelAsk } from "./negotiation-text";

const usd = (n: number) => `$${n.toFixed(2)}`;

export function citationTemplate(ev: Evidence, turn: number): string {
  const paid = Number(ev.fields.paid_amount);
  const cost = Number(ev.fields.acquisition_cost);
  const facts = Number.isFinite(paid) && Number.isFinite(cost) ? ` The claim paid ${usd(paid)} against an acquisition cost of ${usd(cost)}.` : "";
  if (turn > 0) return `To repeat the basis: ${ev.statute}. The underpayment is ${usd(ev.delta)}. Please approve the adjustment.`;
  return `This is RxSolve calling about claim ${ev.claim_id}. The appeal is complete under ${ev.statute}: ${ev.entitlement}${facts} The underpayment is ${usd(ev.delta)}. Please approve the adjustment.`;
}

/** Model-worded citation, accepted only if it keeps the statute and the underpayment figure. */
export async function spokenCitation(ev: Evidence, turn: number, repLine: string, ask?: Ask): Promise<string> {
  const template = citationTemplate(ev, turn);
  const a = modelAsk(ask);
  if (!a) return template;
  try {
    const got = await a(
      z.object({ text: z.string() }),
      [
        "Write what a pharmacy agent says aloud (under 70 words, plain speech) to a PBM appeals rep on the phone.",
        "Cite the statute and the underpayment. Use only these facts. Do not add figures, deadlines or threats.",
        `statute: ${ev.statute}`, `entitlement: ${ev.entitlement}`, `underpayment: ${usd(ev.delta)}`,
        `claim: ${ev.claim_id}`, `rep just said: ${repLine}`,
      ].join("\n"),
    );
    const text = got.text.trim();
    if (!text || text.length > 600 || !text.includes(ev.statute) || !text.includes(usd(ev.delta))) return template;
    return text;
  } catch {
    return template;
  }
}

export type RepOutcome = "approved" | "denied" | "unclear";

const NEGATIVE = /\b(not|cannot|can't|unable|denied|denial stands|decline)/i;
const POSITIVE = /\b(approv\w*|grant\w*|concede\w*|will adjust|adjustment .* will post)\b/i;

/** Deterministic read of a rep line; a model may break an "unclear" tie but never invent an approval. */
export async function readRepLine(text: string, ask?: Ask): Promise<RepOutcome> {
  if (NEGATIVE.test(text)) return "denied";
  if (POSITIVE.test(text)) return "approved";
  const a = modelAsk(ask);
  if (!a || !text.trim()) return "unclear";
  try {
    const got = await a(
      z.object({ outcome: z.enum(["approved", "denied", "unclear"]) }),
      `A PBM rep said this on a call about a pharmacy appeal. Did the rep approve the appeal, deny it, or neither?\n${text}`,
    );
    return got.outcome === "approved" && !POSITIVE.test(text) ? "unclear" : got.outcome;
  } catch {
    return "unclear";
  }
}
