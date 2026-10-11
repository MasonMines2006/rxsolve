import { expect, test } from "bun:test";
import type { ClaimView } from "../lib/state";
import { statusSentence } from "../lib/claims";
import { deliveryState } from "../lib/delivery";
import { accountInfo, balanceChange } from "../lib/ledger";
import { deadlineShort, deadlineUrgent } from "../lib/deadline";

const view = (over: Partial<ClaimView> = {}): ClaimView => ({
  claim: { claim_id: "RXS-1", drug: "Metformin" } as ClaimView["claim"],
  decisions: [],
  actions: [],
  ...over,
});

test("delivery state distinguishes delivered, not delivered, and simulated", () => {
  expect(deliveryState({ delivered: true }).label).toBe("Delivered");
  expect(deliveryState({ delivered: false }).label).toBe("Not delivered (dashboard only)");
  expect(deliveryState({}).label).toBe("Simulated phone");
  expect(deliveryState(undefined).kind).toBe("simulated");
});

test("status sentence reports a denial reason and field", () => {
  const v = view({
    stage: "NEGOTIATING",
    decisions: [{ claim_id: "RXS-1", ticket_id: "T", status: "DENIED", reason: "missing_field", field: "wholesaler_attestation", delta: null, raw: null }],
  });
  expect(statusSentence(v, () => "$0")).toContain("missing paper (signed statement from the wholesaler)");
});


test("ledger helpers label accounts and compute change", () => {
  expect(accountInfo("PBM_PORTAL").name).toBe("PBM account");
  expect(accountInfo("PH-MEADOWBROOK").name).toBe("Pharmacy account");
  expect(accountInfo("RXSOLVE-PLATFORM").name).toBe("Platform account");
  expect(balanceChange(100.3, 100)).toBe(0.3);
  expect(balanceChange(undefined, 1)).toBeNull();
});

test("compact deadline and urgency", () => {
  const now = Date.parse("2026-10-10T12:00:00Z");
  expect(deadlineShort("2026-10-12", now)).toBe("2d 11h");
  expect(deadlineShort("2026-10-01", now)).toBe("Overdue");
  expect(deadlineUrgent("2026-10-11", now)).toBe(true);
  expect(deadlineUrgent("2026-10-30", now)).toBe(false);
});
