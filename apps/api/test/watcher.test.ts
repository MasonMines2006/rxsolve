/** AGT-01: the watcher is deterministic except on MARGINAL, where a (stubbed) agent resolves. */
import { afterEach, expect, test } from "bun:test";
import type { Claim } from "@rxsolve/contracts";
import { adjudicate } from "../src/agents/watcher";
import { config } from "../src/config";

const claim = (paid: number, acq: number | null = 10): Claim =>
  ({
    claim_id: "T-1", pharmacy_id: "PH-X", pbm: "PBM_PORTAL", state: "TN", plan: "TN Part D", patient_ref: "PT-1",
    ndc: "00378001801", qty: 30, fill_date: "2026-10-01", paid_amount: paid, acquisition_cost: acq, nadac: 9, contract_rate: 9.5,
  }) as Claim;

const key = config.agentApiKey;
afterEach(() => {
  config.agentApiKey = key;
});

function stub(verdict: "UNDERWATER" | "CLEAR" | "throw") {
  const calls: string[] = [];
  const ask = (async (_schema: unknown, prompt: string) => {
    calls.push(prompt);
    if (verdict === "throw") throw new Error("model down");
    return { verdict, reason: "stub" };
  }) as never;
  return { ask, calls };
}

test("underwater claim returns UNDERWATER with the correct delta and no model call", async () => {
  config.agentApiKey = "test-key";
  const { ask, calls } = stub("CLEAR");
  const v = await adjudicate(claim(3.6), ask);
  expect(v.verdict).toBe("UNDERWATER");
  expect(v.delta).toBe(6.4);
  expect(v.reason).toBe("underpaid");
  expect(calls.length).toBe(0);
});

test("fair claim is CLEAR with zero model calls", async () => {
  config.agentApiKey = "test-key";
  const { ask, calls } = stub("UNDERWATER");
  const paid = await adjudicate(claim(10.5), ask);
  expect(paid.verdict).toBe("CLEAR");
  expect(paid.reason).toBe("paid_at_or_above_cost");
  const noInvoice = await adjudicate(claim(5, null), ask);
  expect(noInvoice.verdict).toBe("CLEAR");
  expect(noInvoice.reason).toBe("no_invoice");
  expect(calls.length).toBe(0);
});

test("marginal claim is resolved by the agent", async () => {
  config.agentApiKey = "test-key";
  const up = stub("UNDERWATER");
  const a = await adjudicate(claim(9.7), up.ask);
  expect(a.verdict).toBe("UNDERWATER");
  expect(a.delta).toBe(0.3);
  expect(a.appeal_deadline).not.toBeNull();
  expect(a.reason).toBe("marginal_resolved_underwater");
  expect(up.calls.length).toBe(1);
  const b = await adjudicate(claim(9.7), stub("CLEAR").ask);
  expect(b.verdict).toBe("CLEAR");
  expect(b.delta).toBe(0);
  expect(b.reason).toBe("marginal_resolved_clear");
});

test("marginal claim stays MARGINAL with no key or on a model error", async () => {
  config.agentApiKey = "";
  const none = stub("UNDERWATER");
  const unresolved = await adjudicate(claim(9.7), none.ask);
  expect(unresolved.verdict).toBe("MARGINAL");
  expect(unresolved.reason).toBe("marginal_unresolved");
  expect(none.calls.length).toBe(0);
  config.agentApiKey = "test-key";
  expect((await adjudicate(claim(9.7), stub("throw").ask)).verdict).toBe("MARGINAL");
});
