/**
 * Statute entitlement extraction (AGT-02). The model reads the researched statute text from
 * statutes.json; the citation is never model-written. No key or any error falls back to the fixture text.
 */
import { z } from "zod";
import { config } from "../config";
import { statute } from "../reference";
import { extract } from "./llm";

export type Ask = <T extends z.ZodType>(schema: T, prompt: string) => Promise<z.infer<T>>;
export type Entitlement = { citation: string; entitlement: string; source: "model" | "fixture" };

const Extracted = z.object({ entitlement: z.string(), requires_acquisition_cost_floor: z.boolean() });

export async function resolveEntitlement(state: string, ask: Ask = extract): Promise<Entitlement> {
  const law = statute(state);
  const fixture: Entitlement = { citation: law.citation, entitlement: law.entitlement, source: "fixture" };
  if (!config.agentApiKey) return fixture;
  const l = law as Record<string, unknown>;
  const prompt = [
    "Extract the MAC appeal entitlement a pharmacy can invoke, in one or two sentences, using only the text below.",
    "Set requires_acquisition_cost_floor true only if the text ties reimbursement to the pharmacy's acquisition cost.",
    `citation: ${law.citation}`,
    `entitlement: ${law.entitlement}`,
    `remedy: ${l.remedy ?? "n/a"}`,
    `window: ${l.window_basis ?? "n/a"}`,
  ].join("\n");
  try {
    const got = await ask(Extracted, prompt);
    const text = got.entitlement.trim();
    const denies = /does not mention acquisition cost/i.test(law.entitlement);
    if (!text || text.length > 600 || (denies && got.requires_acquisition_cost_floor)) return fixture;
    return { ...fixture, entitlement: text, source: "model" };
  } catch {
    return fixture;
  }
}
