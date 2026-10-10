/**
 * Negotiation wording (AGT-06). Owner: P2.
 * Models only write or read text here; they never decide whether the PBM concedes. Every model answer
 * is checked against facts we hold, and any failure falls back to a deterministic template.
 */
import { z } from "zod";
import type { Decision, Evidence } from "@rxsolve/contracts";
import { config } from "../config";
import type { Ask } from "./entitlement";
import { extract } from "./llm";

/** The injected ask, else the real model when a key is set, else null (deterministic only). */
export function modelAsk(ask?: Ask): Ask | null {
  if (ask) return ask;
  return config.agentApiKey ? extract : null;
}

const usd = (n: number) => `$${n.toFixed(2)}`;

export function rebuttalTemplate(ev: Evidence, denial: Decision): string {
  const paid = Number(ev.fields.paid_amount);
  const cost = Number(ev.fields.acquisition_cost);
  const facts = Number.isFinite(paid) && Number.isFinite(cost) ? ` The claim paid ${usd(paid)} against an acquisition cost of ${usd(cost)}.` : "";
  return [
    `Re: claim ${ev.claim_id}, your denial${denial.raw ? ` ("${denial.raw.slice(0, 160)}")` : ""}.`,
    `The appeal is complete under ${ev.statute}: ${ev.entitlement}${facts}`,
    `The underpayment is ${usd(ev.delta)} and the wholesaler invoice and documentation are attached.`,
    "Please approve the adjustment or route this to supervisor review.",
  ].join(" ");
}

/** Model-worded rebuttal, accepted only if it keeps the citation and the underpayment figure. */
export async function rebuttalText(ev: Evidence, denial: Decision, ask?: Ask): Promise<string> {
  const template = rebuttalTemplate(ev, denial);
  const a = modelAsk(ask);
  if (!a) return template;
  try {
    const got = await a(
      z.object({ text: z.string() }),
      [
        "Write a firm, courteous rebuttal (under 120 words) to a PBM's denial of a pharmacy MAC appeal.",
        "Use only these facts. Do not add figures, deadlines or threats.",
        `statute: ${ev.statute}`, `entitlement: ${ev.entitlement}`, `underpayment: ${usd(ev.delta)}`,
        `claim: ${ev.claim_id}`, `denial wording: ${denial.raw ?? denial.reason ?? "n/a"}`,
      ].join("\n"),
    );
    const text = got.text.trim();
    if (!text || text.length > 900 || !text.includes(ev.statute) || !text.includes(usd(ev.delta))) return template;
    return text;
  } catch {
    return template;
  }
}

/** Names the missing field from a denial's raw wording when the adapter could not. */
export async function fieldFromRaw(raw: string | null, known: string[], ask?: Ask): Promise<string | null> {
  if (!raw) return null;
  const lower = raw.toLowerCase().replace(/[_-]/g, " ");
  const hit = known.find((f) => lower.includes(f.replaceAll("_", " ")));
  if (hit) return hit;
  const a = modelAsk(ask);
  if (!a) return null;
  try {
    const got = await a(
      z.object({ field: z.string().nullable() }),
      `Which required field does this PBM denial say is missing? Answer with one of ${known.join(", ")} or null.\n${raw}`,
    );
    return got.field && known.includes(got.field) ? got.field : null;
  } catch {
    return null;
  }
}
