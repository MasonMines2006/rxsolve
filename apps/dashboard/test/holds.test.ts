import { expect, test } from "bun:test";
import { callRelease, defaultWholesalerText, HOLD_OFF_MESSAGE, holdControl, releaseUrl, sendWholesalerReply } from "../lib/holds";
import type { ClaimView } from "../lib/state";

const claim = { claim_id: "RXS-0007", acquisition_cost: 12.5, fill_date: "2026-10-01" } as ClaimView["claim"];
const ticket = { claim_id: "RXS-0007", ticket_id: "TKT/1" } as ClaimView["ticket"];
const view = (o: Partial<ClaimView> = {}): ClaimView => ({ claim, decisions: [], actions: [], ...o });
const model = (o: object) => ({ active: null, activeActor: null, ended: false, ...o }) as never;

test("shows the PBM control only while filed and waiting outside", () => {
  expect(holdControl(model({ active: "decision_1", activeActor: "external" }), view({ ticket }))).toEqual({
    kind: "pbm", ticketId: "TKT/1", url: "/sim/dev/appeals/TKT%2F1/release",
  });
  expect(holdControl(model({ active: "decision_1", activeActor: "external" }), view())).toBeNull();
  expect(holdControl(model({ active: "decision_1", activeActor: "agent" }), view({ ticket }))).toBeNull();
  expect(holdControl(model({ active: "decision_1", activeActor: "external", ended: true }), view({ ticket }))).toBeNull();
  expect(holdControl(model({ active: "evidence", activeActor: "agent" }), view({ ticket }))).toBeNull();
});

test("shows the wholesaler control with a default text for the missing field", () => {
  const d = [{ claim_id: "RXS-0007", ticket_id: "T", status: "DENIED", reason: "missing_field", field: "invoice_number", delta: null, raw: null }] as ClaimView["decisions"];
  const c = holdControl(model({ active: "missing_field_1", activeActor: "external" }), view({ ticket, decisions: d }));
  expect(c).toMatchObject({ kind: "wholesaler", field: "invoice_number", defaultText: "Attached: invoice number INV-0007" });
  expect(holdControl(model({ active: "missing_field_1", activeActor: "agent" }), view({ decisions: d }))).toBeNull();
});

test("default wholesaler text suits each field parser", () => {
  expect(defaultWholesalerText("acquisition_cost", claim)).toBe("Unit cost per invoice: $12.5");
  expect(defaultWholesalerText("invoice_date", claim)).toBe("Attached: invoice date 2026-10-01");
  expect(defaultWholesalerText("wholesaler_attestation", claim)).toBe("Attached: wholesaler attestation ATT-0007");
  expect(defaultWholesalerText(null, claim)).toBe("Attached: document ATT-0007");
});

const reply = (status: number, body: unknown) => (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;

test("release maps results and degrades on 404 or network error", async () => {
  expect(releaseUrl("A")).toBe("/sim/dev/appeals/A/release");
  expect(await callRelease("/x", reply(200, { released: true, ticket_id: "A" }))).toMatchObject({ ok: true });
  expect(await callRelease("/x", reply(200, { released: 3 }))).toEqual({ ok: true, detail: "Released 3 held requests." });
  expect(await callRelease("/x", reply(200, { released: false }))).toMatchObject({ ok: true });
  expect(await callRelease("/x", reply(404, {}))).toEqual({ ok: false, detail: HOLD_OFF_MESSAGE });
  expect(await callRelease("/x", (async () => { throw new Error("down"); }) as unknown as typeof fetch)).toEqual({ ok: false, detail: HOLD_OFF_MESSAGE });
});

test("wholesaler reply posts the body and reports failure", async () => {
  let seen: RequestInit | undefined;
  const f = (async (_u: string, init: RequestInit) => { seen = init; return new Response("{}"); }) as unknown as typeof fetch;
  expect((await sendWholesalerReply("hi", "sms", f)).ok).toBe(true);
  expect(JSON.parse(seen!.body as string)).toEqual({ text: "hi", channel: "sms" });
  expect((await sendWholesalerReply("hi", undefined, reply(500, {}))).ok).toBe(false);
});
