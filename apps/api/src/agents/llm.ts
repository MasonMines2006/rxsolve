/**
 * Agent model access. Owner: P2.
 * Only where DESIGN.md allows a model: MARGINAL verdicts, statute/evidence extraction, reading denials
 * (portal, email, scanned fax), negotiation. Never for a PBM's concede/deny decision.
 *
 *   const Entitlement = z.object({ text: z.string(), requires_acquisition_cost_floor: z.boolean() });
 *   const ent = await extract(Entitlement, `Extract the MAC appeal entitlement from:\n${statuteText}`);
 */
import { GoogleGenAI, ThinkingLevel } from "@google/genai";
import { z } from "zod";
import { config } from "../config";

export const MODEL = process.env.AGENT_MODEL || "gemini-3.8-flash";
let client: GoogleGenAI | null = null;
let clientKey = "";

const THINKING = { low: ThinkingLevel.LOW, medium: ThinkingLevel.MEDIUM, high: ThinkingLevel.HIGH } as const;

export type ExtractOpts = {
  system?: string;
  effort?: "low" | "medium" | "high";
  /** Inline documents (e.g. a PDF) sent ahead of the prompt as base64 parts. */
  documents?: { mimeType: string; data: Uint8Array }[];
};

export async function extract<T extends z.ZodType>(schema: T, prompt: string, opts: ExtractOpts = {}): Promise<z.infer<T>> {
  if (!client || clientKey !== config.agentApiKey) {
    clientKey = config.agentApiKey;
    client = new GoogleGenAI({ apiKey: clientKey || undefined });
  }
  const { $schema: _omit, ...jsonSchema } = z.toJSONSchema(schema) as Record<string, unknown>;
  const parts = [
    ...(opts.documents ?? []).map((d) => ({ inlineData: { mimeType: d.mimeType, data: Buffer.from(d.data).toString("base64") } })),
    { text: prompt },
  ];
  const response = await client.models.generateContent({
    model: MODEL,
    contents: [{ role: "user", parts }],
    config: {
      systemInstruction: opts.system ?? "You are part of RxSolve, a pharmacy claims recovery system. Be exact; never invent figures.",
      responseMimeType: "application/json",
      responseJsonSchema: jsonSchema,
      thinkingConfig: { thinkingLevel: THINKING[opts.effort ?? "medium"] },
    },
  });
  const text = response.text;
  if (!text) throw new Error(`agent model returned no usable output (finish_reason=${response.candidates?.[0]?.finishReason})`);
  return schema.parse(JSON.parse(text));
}
