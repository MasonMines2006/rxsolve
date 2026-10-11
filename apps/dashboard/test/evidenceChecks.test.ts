import { expect, test } from "bun:test";
import type { ChannelMessage } from "@rxsolve/contracts";
import { cite, evidenceChecks, probeNames } from "../lib/evidenceChecks";
import { chipFor, groupExchange } from "../lib/exchangeSteps";
import type { ClaimView } from "../lib/state";

const ID = "RXS-1";
const ev = (over: object = {}) => ({ claim_id: ID, statute: "TN Code 56-7-3105 (pharmacy benefit appeals)", entitlement: "", attachments: [`appeal_${ID}.pdf`, `wholesaler_invoice_${ID}.pdf`], required_fields_present: [], spec_version: "1", completeness: 1, fields: {}, delta: 4, appeal_deadline: null, ...over }) as NonNullable<ClaimView["evidence"]>;
const view = (over: Partial<ClaimView> = {}): ClaimView => ({ claim: { claim_id: ID, drug: "x" } as ClaimView["claim"], decisions: [], actions: [], evidence: ev(), ...over });
const denial = { claim_id: ID, ticket_id: "T", status: "DENIED", reason: "missing_field", field: "wholesaler_attestation", delta: null, raw: null } as ClaimView["decisions"][number];
const msg = (o: Partial<ChannelMessage>): ChannelMessage =>
  ({ claim_id: ID, channel: "portal", direction: "out", counterparty: "PBM_PORTAL", text: "", attachments: [], audio_url: null, meta: {}, ts: "2026-10-11T10:00:00Z", ...o });
const label = (checks: ReturnType<typeof evidenceChecks>, state: string) => checks.find((c) => c.state === state);

test("invoice is ticked only when the probe confirms the file exists", () => {
  const name = `wholesaler_invoice_${ID}.pdf`;
  expect(probeNames(view())).toEqual([name]);
  expect(label(evidenceChecks(view(), [], { [name]: "ok" }), "invoice-ok")?.label).toBe("✓ Invoice attached");
  expect(label(evidenceChecks(view(), [], { [name]: "missing" }), "invoice-stub")).toMatchObject({ label: "Invoice not available (stub)", tone: "muted" });
  expect(label(evidenceChecks(view(), [], { [name]: "unverified" }), "invoice-unverified")).toBeTruthy();
  expect(label(evidenceChecks(view(), [], {}), "invoice-pending")).toBeTruthy();
  expect(label(evidenceChecks(view({ evidence: ev({ attachments: ["appeal.pdf"] }) }), [], {}), "invoice-none")?.tone).toBe("bad");
});

test("state law shows the real citation, truncated", () => {
  const c = label(evidenceChecks(view(), [], {}), "law-cited")!;
  expect(c.label.startsWith("✓ State law: TN Code 56-7-3105")).toBe(true);
  expect(cite("a".repeat(60), 10)).toBe("aaaaaaaaa...");
  expect(label(evidenceChecks(view({ evidence: ev({ statute: "" }) }), [], {}), "law-none")).toBeTruthy();
});

test("a requested paper is missing, then requested, then supplied only when refiled with its file", () => {
  const v = view({ decisions: [denial], actions: [{ kind: "REFILED" }] });
  expect(label(evidenceChecks(v, [], {}), "paper-missing")?.tone).toBe("bad");
  const asked = msg({ channel: "whatsapp", counterparty: "wholesaler", text: "send it" });
  expect(label(evidenceChecks(v, [asked], {}), "paper-requested")?.label).toBe("Asked the wholesaler for the signed statement");
  const first = msg({ attachments: [`appeal_${ID}.pdf`] });
  const refile = msg({ attachments: [`appeal_${ID}.pdf`, `wholesaler_attestation_${ID}.pdf`] });
  expect(label(evidenceChecks(v, [asked, first], {}), "paper-supplied")).toBeUndefined();
  expect(label(evidenceChecks(v, [asked, first, refile], {}), "paper-supplied")?.label).toBe("✓ Signed statement from the wholesaler supplied");
});

test("delivery chips: delivered, not delivered, simulated, and stub replies", () => {
  expect(chipFor(msg({ channel: "whatsapp", meta: { delivered: true } }))?.label).toBe("Delivered");
  expect(chipFor(msg({ channel: "whatsapp", meta: { delivered: false } }))?.kind).toBe("not-delivered");
  expect(chipFor(msg({ channel: "sms", meta: {} }))?.label).toBe("Simulated");
  expect(chipFor(msg({ channel: "whatsapp", direction: "in", meta: { stub: true } }))?.label).toBe("Simulated reply (demo stub)");
  expect(chipFor(msg({ channel: "portal" }))).toBeNull();
});

test("a WhatsApp send retried by SMS becomes one step, then the stub reply", () => {
  const w = msg({ channel: "whatsapp", counterparty: "wholesaler", text: "Send the invoice", meta: { delivered: false }, ts: "2026-10-11T10:00:00Z" });
  const s = msg({ channel: "sms", counterparty: "wholesaler", text: "Send the invoice", meta: { delivered: false }, ts: "2026-10-11T10:00:02Z" });
  const reply = msg({ channel: "sms", counterparty: "wholesaler", direction: "in", text: "Attached", meta: { stub: true }, ts: "2026-10-11T10:00:03Z" });
  const steps = groupExchange([w, s, reply]);
  expect(steps).toHaveLength(2);
  expect(steps[0]).toMatchObject({ type: "fallback", label: "WhatsApp not delivered, retried by SMS (not delivered)" });
  expect(steps[1]).toMatchObject({ type: "message", chip: { label: "Simulated reply (demo stub)" } });
  const ok = groupExchange([w, { ...s, meta: { delivered: true } }]);
  expect(ok[0]).toMatchObject({ label: "WhatsApp not delivered, retried by SMS (delivered)" });
  const far = groupExchange([w, { ...s, ts: "2026-10-11T10:05:00Z" }]);
  expect(far).toHaveLength(2);
});
