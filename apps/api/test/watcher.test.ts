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
  expect(calls.length).toBe(0);
});

test("fair claim is CLEAR with zero model calls", async () => {
  config.agentApiKey = "test-key";
  const { ask, calls } = stub("UNDERWATER");
  expect((await adjudicate(claim(10.5), ask)).verdict).toBe("CLEAR");
  expect((await adjudicate(claim(5, null), ask)).verdict).toBe("CLEAR");
  expect(calls.length).toBe(0);
});

test("marginal claim is resolved by the agent", async () => {
  config.agentApiKey = "test-key";
  const up = stub("UNDERWATER");
  const a = await adjudicate(claim(9.7), up.ask);
  expect(a.verdict).toBe("UNDERWATER");
  expect(a.delta).toBe(0.3);
  expect(a.appeal_deadline).not.toBeNull();
  expect(up.calls.length).toBe(1);
  const b = await adjudicate(claim(9.7), stub("CLEAR").ask);
  expect(b.verdict).toBe("CLEAR");
  expect(b.delta).toBe(0);
});

test("marginal claim stays MARGINAL with no key or on a model error", async () => {
  config.agentApiKey = "";
  const none = stub("UNDERWATER");
  expect((await adjudicate(claim(9.7), none.ask)).verdict).toBe("MARGINAL");
  expect(none.calls.length).toBe(0);
  config.agentApiKey = "test-key";
  expect((await adjudicate(claim(9.7), stub("throw").ask)).verdict).toBe("MARGINAL");
});
