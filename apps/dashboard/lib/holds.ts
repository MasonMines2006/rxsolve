/** Which presenter control a claim's active step offers, and the calls behind it. Owner: P3. Pure. */
import type { ChannelMessage } from "@rxsolve/contracts";
import type { ClaimView } from "./state";
import type { TreeModel } from "./tree";

export type HoldControl =
  | { kind: "pbm"; ticketId: string; url: string }
  | { kind: "wholesaler"; field: string; defaultText: string; channel?: "whatsapp" | "sms" };

export const RELEASE_ALL_URL = "/sim/dev/appeals/release-all";
export const WHOLESALER_REPLY_URL = "/api/dev/wholesaler-reply";
export const releaseUrl = (ticket: string) => `/sim/dev/appeals/${encodeURIComponent(ticket)}/release`;
export const HOLD_OFF_MESSAGE = "Hold mode is off or the PBM Sim lacks the release door.";

/** Reply text the wholesaler parser accepts for the missing field. */
export function defaultWholesalerText(field: string | null | undefined, claim: { claim_id: string; acquisition_cost: number | null; fill_date?: string }): string {
  const id = claim.claim_id.replace(/^RXS-/, "");
  const what = (field ?? "document").replaceAll("_", " ");
  if (field === "acquisition_cost") return `Unit cost per invoice: $${claim.acquisition_cost ?? 0}`;
  if (field === "invoice_number") return `Attached: ${what} INV-${id}`;
  if (field === "invoice_date") return `Attached: ${what} ${claim.fill_date ?? new Date().toISOString().slice(0, 10)}`;
  return `Attached: ${what} ATT-${id}`;
}

/** The control to show, or null unless the claim is really waiting on that outside step. */
export function holdControl(model: Pick<TreeModel, "active" | "activeActor" | "ended">, view: ClaimView, wholesaler: readonly ChannelMessage[] = []): HoldControl | null {
  if (model.ended || model.active === null || model.activeActor !== "external") return null;
  if (model.active.startsWith("decision_") && view.ticket) {
    return { kind: "pbm", ticketId: view.ticket.ticket_id, url: releaseUrl(view.ticket.ticket_id) };
  }
  if (model.active.startsWith("missing_field_")) {
    const field = view.decisions.at(-1)?.field ?? "document";
    const ch = wholesaler.at(-1)?.channel;
    return {
      kind: "wholesaler", field, defaultText: defaultWholesalerText(field, view.claim),
      channel: ch === "whatsapp" || ch === "sms" ? ch : undefined,
    };
  }
  return null;
}

export type CallResult = { ok: true; detail: string } | { ok: false; detail: string };

/** Releases one held request; a 404 or network error maps to the hold-off message instead of throwing. */
export async function callRelease(url: string, doFetch: typeof fetch = fetch): Promise<CallResult> {
  try {
    const r = await doFetch(url, { method: "POST" });
    if (r.status === 404) return { ok: false, detail: HOLD_OFF_MESSAGE };
    if (!r.ok) return { ok: false, detail: `PBM Sim answered ${r.status}.` };
    const body = (await r.json().catch(() => ({}))) as { released?: boolean | number };
    if (typeof body.released === "number") return { ok: true, detail: `Released ${body.released} held request${body.released === 1 ? "" : "s"}.` };
    return body.released === false
      ? { ok: true, detail: "Nothing was held for this request; the PBM may already be responding." }
      : { ok: true, detail: "Released. The PBM will respond now." };
  } catch {
    return { ok: false, detail: HOLD_OFF_MESSAGE };
  }
}

export async function sendWholesalerReply(text: string, channel?: string, doFetch: typeof fetch = fetch): Promise<CallResult> {
  try {
    const r = await doFetch(WHOLESALER_REPLY_URL, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify(channel ? { text, channel } : { text }),
    });
    return r.ok ? { ok: true, detail: "Reply sent as the wholesaler." } : { ok: false, detail: `API answered ${r.status}.` };
  } catch {
    return { ok: false, detail: "Could not reach the API." };
  }
}
