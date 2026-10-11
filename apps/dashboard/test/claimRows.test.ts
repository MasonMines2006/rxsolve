import { expect, test } from "bun:test";
import type { LiveEvent } from "@rxsolve/contracts";
import { buildClaimRows, relativeTime, rowSummary } from "../lib/claimRows";
import { exchangeFor, rawFields } from "../lib/exchange";
import type { ClaimView } from "../lib/state";

const mk = (id: string, over: Partial<ClaimView> = {}, claim: object = {}): ClaimView => ({
  claim: { claim_id: id, drug: "Metformin", qty: 1000, pbm: "PBM_PORTAL", state: "TN", patient_ref: "PT-1", ...claim } as ClaimView["claim"],
  decisions: [], actions: [], ...over,
});
const rec = (id: string, ts: string) => ({ type: "claim.received", ts, claim_id: id, payload: {} }) as unknown as LiveEvent;

test("rows include seeded claims, sort newest first, keep duplicates and quiet CLEAR rows", () => {
  const live = {
    claims: {
      "RXS-1": mk("RXS-1", { stage: "FILED", verdict: { verdict: "UNDERWATER", delta: 4, appeal_deadline: "2026-10-30" } as never }),
      "RXS-2": mk("RXS-2", { stage: "CLEARED", verdict: { verdict: "CLEAR", delta: 0 } as never }),
      "RXS-3": mk("RXS-3", { stage: "FILED", verdict: { verdict: "UNDERWATER", delta: 4 } as never }),
    },
    order: ["RXS-3", "RXS-2", "RXS-1"],
    log: [rec("RXS-1", "2026-10-11T10:00:00Z"), rec("RXS-2", "2026-10-11T10:01:00Z"), rec("RXS-3", "2026-10-11T10:02:00Z")],
  };
  const rows = buildClaimRows(live);
  expect(rows.map((r) => r.claimId)).toEqual(["RXS-3", "RXS-2", "RXS-1"]);
  expect(rows[1]).toMatchObject({ quiet: true, paidAtCost: true, delta: null });
  expect(rows[0]!.ordinal).toBe(3);
  expect(rows[2]!.ordinal).toBe(1);
  const s = rowSummary(rows[2]!, Date.parse("2026-10-11T10:05:00Z"));
  expect(s.summary).toBe("qty 1000 · PBM Portal · 5 min ago · fill 1");
  expect(s.label + s.summary).not.toMatch(/RXS-|PT-/);
});

test("relative time and exchange helpers", () => {
  expect(relativeTime(1000, 1000)).toBe("just now");
  expect(relativeTime(0, 3 * 3600_000)).toBe("3 h ago");
  const m = (claim_id: string, ts: string) => ({ claim_id, ts, channel: "sms", direction: "in", counterparty: "x", text: "", attachments: [], audio_url: null, meta: {} }) as never;
  expect(exchangeFor("A", [m("A", "2026-01-02T00:00:00Z"), m("B", "2026-01-01T00:00:00Z")], [m("A", "2026-01-01T00:00:00Z")]).map((x: { ts: string }) => x.ts))
    .toEqual(["2026-01-01T00:00:00Z", "2026-01-02T00:00:00Z"]);
  const f = rawFields(mk("RXS-1"));
  expect(f[0]).toEqual(["Claim id", "RXS-1"]);
  expect(f.at(-1)).toEqual(["Spec version", "—"]);
});

test("paid-fairly claims never read as recovered; only settled claims do", () => {
  const live = {
    claims: {
      "RXS-1": mk("RXS-1", { stage: "CLEARED", verdict: { verdict: "CLEAR", delta: 0 } as never }, { paid_amount: 12, acquisition_cost: 9 }),
      "RXS-2": mk("RXS-2", { stage: "SETTLED", verdict: { verdict: "UNDERWATER", delta: 4 } as never }),
    },
    order: ["RXS-2", "RXS-1"],
    log: [rec("RXS-1", "2026-10-11T10:00:00Z"), rec("RXS-2", "2026-10-11T10:01:00Z")],
  };
  const by = Object.fromEntries(buildClaimRows(live).map((r) => [r.claimId, r]));
  expect(by["RXS-1"]!.pill.label).toBe("PAID FAIRLY");
  expect(by["RXS-1"]!.paidAtCost).toBe(true);
  expect(by["RXS-2"]!.pill.label).toBe("RECOVERED");
});
