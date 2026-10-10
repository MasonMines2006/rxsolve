/**
 * Agent model access. Owner: P2.
 * Only where DESIGN.md allows a model: MARGINAL verdicts, statute/evidence extraction, reading denials
 * (portal, email, scanned fax), negotiation. Never for a PBM's concede/deny decision.
 *
 *   const Entitlement = z.object({ text: z.string(), requires_acquisition_cost_floor: z.boolean() });
 *   const ent = await extract(Entitlement, `Extract the MAC appeal entitlement from:\n${statuteText}`);
 */
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import type { z } from "zod";
import { config } from "../config";

export const MODEL = "claude-opus-5-5";
let client: Anthropic | null = null;

export async function extract<T extends z.ZodType>(schema: T, prompt: string, opts: { system?: string; effort?: "low" | "medium" | "high" } = {}): Promise<z.infer<T>> {
  client ??= new Anthropic({ apiKey: config.agentApiKey || undefined });
  const response = await client.beta.messages.parse({
    model: MODEL,
    max_tokens: 16000,
    system: opts.system ?? "You are part of RxSolve, a pharmacy claims recovery system. Be exact; never invent figures.",
    messages: [{ role: "user", content: prompt }],
    output_config: { format: betaZodOutputFormat(schema), effort: opts.effort ?? "medium" },
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default", // a safety-classifier refusal re-runs on Anthropic's recommended fallback model
  });
  if (response.stop_reason === "refusal" || response.parsed_output == null)
    throw new Error(`agent model returned no usable output (stop_reason=${response.stop_reason})`);
  return response.parsed_output;
}
