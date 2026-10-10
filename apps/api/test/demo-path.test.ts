/**
 * The demo path end to end over real HTTP: seed claim -> PBM Sim switch -> claim feed -> orchestrator
 * -> direct adapter -> PBM Sim dev door -> settlement on the local ledger.
 */
import { afterAll, beforeAll, beforeEach, expect, test } from "bun:test";
import { TERMINAL_STAGES, type Stage } from "@rxsolve/contracts";
import seed from "../../../seed/claims.json";
import { startSim } from "../../pbm-sim/src/server";
import { config } from "../src/config";
import { getDb, resetDb } from "../src/db";
import { bus } from "../src/events";
import { resetLedger } from "../src/ledger";
import { ledgerSummary } from "../src/ledger/settle";
import { bootstrap, startApi } from "../src/server";

let sim: ReturnType<typeof startSim>;
let api: ReturnType<typeof startApi>;

beforeAll(() => {
  process.env.PBM_SIM_DELAY_SCALE = "0";
  Object.assign(config, { mongoUri: "", ledgerBackend: "local", adapterMode: "direct", photonProjectId: "", elevenlabsApiKey: "", pollIntervalMs: 10 });
  sim = startSim(0);
  api = startApi(0);
  config.pbmSimUrl = sim.url;
  process.env.CLAIM_FEED_URL = `${api.url}/api/feed/claim`;
});
afterAll(() => { sim.stop(); api.stop(); });
beforeEach(async () => {
  resetDb();
  resetLedger();
  bus.clear();
  await bootstrap({ spectrum: false });
});

async function run(claimId: string): Promise<Stage> {
  const c = seed.claims.find((x) => x.claim_id === claimId)!;
  await fetch(`${sim.url}/switch/claim`, {
    method: "POST",
    body: JSON.stringify({ transaction: "B1", meta: { claim_id: claimId, ...c.meta }, request: c.request }),
  });
  for (let i = 0; i < 200; i++) {
    const s = (await getDb().claims.get(claimId))?.stage;
    if (s && TERMINAL_STAGES.includes(s)) return s;
    await Bun.sleep(10);
  }
  throw new Error(`${claimId} did not reach a terminal stage`);
}

test("portal claim: TN attestation denial, wholesaler remediation, refile, settlement", async () => {
  expect(await run("RXS-0001")).toBe("SETTLED");
  const claim = await getDb().claims.get("RXS-0001");
  expect(claim?.paid_amount).toBe(6.4);
  expect(claim?.acquisition_cost).toBe(12.8);

  const decisions = bus.history().filter((e) => e.type === "appeal.decision").map((e) => e.payload as { status: string; field: string | null });
  expect(decisions.map((d) => d.status)).toEqual(["DENIED", "APPROVED"]);
  expect(decisions[0]?.field).toBe("wholesaler_attestation");

  const ledger = await ledgerSummary();
  expect(ledger.recovered_to_date).toBe(6.4);
  expect(ledger.fees_to_date).toBe(1.6);
  expect(await getDb().remittances.get("REM-0001")).not.toBeNull();
});

test.each([
  ["RXS-0002", "SETTLED"],
  ["RXS-0003", "SETTLED"],
  ["RXS-0004", "CLEARED"],
  ["RXS-0005", "EXCEPTION"], // marginal
  ["RXS-0006", "EXCEPTION"], // over the standing-authorization limit
] as const)("%s -> %s", async (id, stage) => {
  expect(await run(id)).toBe(stage);
});
