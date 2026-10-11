/**
 * Wholesaler Contact (AGT-06). Owner: P2.
 * Asks the wholesaler for a missing document over WhatsApp, falling back to SMS, then waits for the
 * inbound reply. With no Photon delivery the exchange is stubbed (see STUB below) so the demo never halts.
 * STUB: WHOLESALER_STUB=auto (default) replies instantly, silent never replies, manual waits for
 * POST /api/dev/wholesaler-reply from the dashboard phone mock.
 */
import { z } from "zod";
import type { Claim } from "@rxsolve/contracts";
import { config } from "../config";
import { send } from "../messaging";
import { deliverInbound, waitForReply } from "../messaging/inbox";
import { spectrumReady } from "../messaging/spectrum";
import { invoice } from "../reference";
import { record } from "../transcript";
import type { Ask } from "./entitlement";
import type { RemediationDoc } from "./evidence";
import { modelAsk } from "./negotiation-text";

export type StubMode = "auto" | "silent" | "manual";
export type WholesalerOpts = { ask?: Ask; timeoutMs?: number; stub?: StubMode };

/** Mutable like `config`: tests and the demo operator tune the wait and the stub behaviour. */
export const wholesalerConfig = {
  timeoutMs: Number(process.env.WHOLESALER_TIMEOUT_MS ?? 30_000),
  stub: (process.env.WHOLESALER_STUB ?? "auto") as StubMode,
};

/** Contact for the claim's wholesaler: WHOLESALER_CONTACT, else a `wholesaler_contact` on the invoice fixture. */
export function wholesalerContact(claim: Claim): string {
  const line = invoice(claim.ndc) as { wholesaler_contact?: string } | undefined;
  return config.wholesalerContact || line?.wholesaler_contact || "";
}

const refusal = /\b(can't|cannot|can not|unable|won't|no longer|don't have|do not have|not available|unavailable|unknown)\b/i;

/** Deterministic read of a reply: the value for the field, or null when it was not supplied. */
export function parseReply(text: string, field: string): string | null {
  if (refusal.test(text) && !/\battached\b/i.test(text)) return null;
  const pick = (re: RegExp) => text.match(re)?.[1] ?? text.match(re)?.[0] ?? null;
  if (field === "acquisition_cost") return pick(/\$?\s*(\d+(?:\.\d{1,4})?)\b/);
  if (field === "invoice_date") return pick(/\b(\d{4}-\d{2}-\d{2})\b/);
  if (field === "invoice_number") return pick(/\b(INV-[\w-]+)\b/i);
  if (field === "wholesaler_attestation") return pick(/\b(ATT-[\w-]+)\b/i);
  return pick(/\b([A-Z]{2,5}-[\w-]+)\b/) ?? pick(/:\s*([\w.-]+)/);
}

/** Model reads the reply; its value must literally appear in the text, else the deterministic parse stands. */
export async function readReply(text: string, field: string, ask?: Ask): Promise<string | null> {
  const fallback = parseReply(text, field);
  const a = modelAsk(ask);
  if (!a) return fallback;
  try {
    const got = await a(
      z.object({ provided: z.boolean(), value: z.string().nullable() }),
      `A wholesaler replied to our request for "${field.replaceAll("_", " ")}". Did they supply it, and what is the value (id, number or date, copied exactly)?\n\n${text}`,
    );
    if (!got.provided) return null;
    const v = got.value?.trim();
    return v && text.includes(v) ? v : fallback;
  } catch {
    return fallback;
  }
}

function stubValue(claim: Claim, field: string): string {
  const id = claim.claim_id.replace(/^RXS-/, "");
  const inv = invoice(claim.ndc);
  if (field === "acquisition_cost") return String(claim.acquisition_cost ?? inv?.unit_cost ?? "");
  if (field === "invoice_number") return inv?.invoice_number ?? `INV-${id}`;
  if (field === "invoice_date") return inv?.invoice_date ?? claim.fill_date;
  return `ATT-${id}`;
}

/** Asks the wholesaler for `field` and returns the supplied document, or null if none arrives in time. */
export async function requestDocument(claim: Claim, field: string, opts: WholesalerOpts = {}): Promise<RemediationDoc | null> {
  const what = field.replaceAll("_", " ");
  const contact = wholesalerContact(claim);
  const mode = opts.stub ?? wholesalerConfig.stub;
  const text = `Hi, this is RxSolve for ${claim.pharmacy_id}. Can you send the ${what} for NDC ${claim.ndc}? It is needed to complete a pharmacy appeal (claim ${claim.claim_id}).`;
  const wait = waitForReply(contact, opts.timeoutMs ?? wholesalerConfig.timeoutMs);

  let channel: "whatsapp" | "sms" = "whatsapp";
  let live = false;
  let stubbedValue: string | null = null;
  let sent = await send(channel, contact, text, { counterparty: "wholesaler", claimId: claim.claim_id });
  live = sent.meta.delivered === true;
  if (!live && spectrumReady()) {
    channel = "sms";
    sent = await send(channel, contact, text, { counterparty: "wholesaler", claimId: claim.claim_id });
    live = sent.meta.delivered === true;
  }

  if (!live && mode === "auto") {
    stubbedValue = stubValue(claim, field);
    const reply = field === "acquisition_cost" ? `Unit cost per invoice: $${stubbedValue}` : `Attached: ${what} ${stubbedValue}`;
    setTimeout(() => {
      void record({
        claim_id: claim.claim_id, channel, direction: "in", counterparty: "wholesaler", text: reply,
        attachments: [`${field}_${claim.claim_id}.pdf`], meta: { stub: true },
      }).then(() => deliverInbound(contact, reply));
    }, 0);
  }

  const reply = await wait.promise;
  wait.cancel();
  if (reply === null) return null;
  if (stubbedValue !== null) return stubbedValue ? { field, value: stubbedValue, text: reply } : null;
  const value = await readReply(reply, field, opts.ask);
  return value ? { field, value, text: reply } : null;
}
