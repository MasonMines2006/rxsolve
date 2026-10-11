import { expect, test } from "bun:test";
import type { ClaimView } from "../lib/state";
import { journeySteps, queueStatus, statusSentence } from "../lib/claims";
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

test("journey marks the negotiating step skipped when nothing was denied", () => {
  const steps = journeySteps(view({ stage: "SETTLED" }));
  expect(steps.map((s) => s.state)).toEqual(["done", "done", "done", "skip", "done"]);
  const live = journeySteps(view({ stage: "FILED" }));
  expect(live.map((s) => s.state)).toEqual(["done", "done", "now", "todo", "todo"]);
});

test("status sentence reports a denial reason and field", () => {
  const v = view({
    stage: "NEGOTIATING",
    decisions: [{ claim_id: "RXS-1", ticket_id: "T", status: "DENIED", reason: "missing_field", field: "attestation", delta: null, raw: null }],
  });
  expect(statusSentence(v, () => "$0")).toContain("missing field (attestation)");
});

test("queue status follows submission and live stage", () => {
  expect(queueStatus({ submitting: false, submitted: false, rejected: false }).label).toBe("QUEUED");
  expect(queueStatus({ submitting: true, submitted: false, rejected: false }).label).toBe("SENDING");
  expect(queueStatus({ submitting: false, submitted: true, rejected: false, view: view({ stage: "EXCEPTION" }) }).label).toBe("NEEDS YOU");
  expect(queueStatus({ submitting: false, submitted: true, rejected: false, view: view({ stage: "SETTLED" }) }).tone).toBe("good");
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
