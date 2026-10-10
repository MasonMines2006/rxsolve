/**
 * Reads a PBM's returned fax PDF into a Decision. The model (vision over the PDF) is tried when a key is
 * set; with no key or on any model error, the embedded text layer is parsed deterministically.
 */
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import type { Decision } from "@rxsolve/contracts";
import { MODEL } from "../agents/llm";
import { config } from "../config";
import { pdfText } from "./fax-pdf";

export type FaxRead = Pick<Decision, "status" | "reason" | "field" | "delta" | "raw">;

const Schema = z.object({
  status: z.enum(["APPROVED", "DENIED"]),
  reason: z.enum(["missing_field", "insufficient_evidence", "disputed", "window_expired", "not_eligible"]).nullable(),
  field: z.string().nullable(),
  delta: z.number().nullable(),
  message: z.string(),
});

/** Deterministic parse of the reply's text layer. Returns null when no verdict wording is found. */
export function parseText(lines: string[]): FaxRead | null {
  const raw = lines.join("\n").trim();
  const t = raw.toLowerCase();
  const denied = /\bdenied\b|\bdenial\b|\bnot approved\b/.test(t);
  if (!denied && /\bapproved\b/.test(t)) {
    const m = raw.match(/\$\s*([\d,]+(?:\.\d{1,2})?)/);
    return { status: "APPROVED", reason: null, field: null, delta: m ? Number(m[1]!.replace(/,/g, "")) : null, raw };
  }
  if (!denied) return null;
  if (/missing/.test(t)) {
    const f = raw.match(/missing[^()]*\(([^)]+)\)/i)?.[1] ?? raw.match(/missing field:\s*([\w ]+)/i)?.[1];
    return { status: "DENIED", reason: "missing_field", field: f ? f.trim().toLowerCase().replace(/\s+/g, "_") : null, delta: null, raw };
  }
  const reason = /window|expired|untimely/.test(t) ? "window_expired"
    : /not eligible|ineligible/.test(t) ? "not_eligible"
    : /insufficient/.test(t) ? "insufficient_evidence" : "disputed";
  return { status: "DENIED", reason, field: null, delta: null, raw };
}

async function readWithModel(pdf: Uint8Array): Promise<FaxRead> {
  const client = new Anthropic({ apiKey: config.agentApiKey });
  const ask =
    'Read this PBM reply to a MAC appeal. Reply with JSON only: {"status":"APPROVED"|"DENIED","reason":"missing_field"|"insufficient_evidence"|"disputed"|"window_expired"|"not_eligible"|null,"field":<snake_case missing field or null>,"delta":<approved dollar adjustment or null>,"message":<the PBM decision wording>}';
  const msg = await client.messages.create({
    model: MODEL,
    max_tokens: 1000,
    system: "You read scanned PBM fax replies for a pharmacy claims recovery system. Return only JSON. Never invent figures.",
    messages: [{
      role: "user",
      content: [
        { type: "document", source: { type: "base64", media_type: "application/pdf", data: Buffer.from(pdf).toString("base64") } },
        { type: "text", text: ask },
      ],
    }],
  });
  const text = msg.content.map((b) => (b.type === "text" ? b.text : "")).join("");
  const json = text.match(/\{[\s\S]*\}/)?.[0];
  if (!json) throw new Error("no JSON in model reply");
  const p = Schema.parse(JSON.parse(json));
  return { status: p.status, reason: p.status === "DENIED" ? p.reason : null, field: p.field, delta: p.delta, raw: p.message };
}

export async function readFaxReply(pdf: Uint8Array, model: (pdf: Uint8Array) => Promise<FaxRead> = readWithModel): Promise<FaxRead> {
  if (config.agentApiKey) {
    try {
      return await model(pdf);
    } catch {
      // fall through to the text layer
    }
  }
  const parsed = parseText(pdfText(pdf));
  if (!parsed) throw new Error("fax reply unreadable: no model result and no verdict in the text layer");
  return parsed;
}
