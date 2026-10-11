/**
 * The demo path end to end over real HTTP: seed claim -> PBM Sim switch -> claim feed -> orchestrator
 * -> direct adapter -> PBM Sim dev door -> settlement on the local ledger.
 */
import { afterAll, beforeAll, beforeEach, expect, test } from "bun:test";
import { TERMINAL_STAGES, type RecoveryPoint, type Stage } from "@rxsolve/contracts";
import seed from "../../../seed/claims.json";
import { seedClaims } from "../../../seed/expand";
import { startSim } from "../../pbm-sim/src/server";
import { config } from "../src/config";
import { getDb, recoverySeries, resetDb } from "../src/db";
import { bus } from "../src/events";
import { resetLedger } from "../src/ledger";
import { ledgerSummary } from "../src/ledger/settle";
import { bootstrap, startApi } from "../src/server";

let sim: ReturnType<typeof startSim>;
let api: ReturnType<typeof startApi>;

beforeAll(() => {
  process.env.PBM_SIM_DELAY_SCALE = "0";
  Object.assign(config, { databaseUrl: "", ledgerBackend: "local", adapterMode: "direct", photonProjectId: "", elevenlabsApiKey: "", pollIntervalMs: 10 });
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

async function run(claimId: string, sourceId = claimId): Promise<Stage> {
  const c = seed.claims.find((x) => x.claim_id === sourceId)!;
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

  const series = (await (await fetch(`${api.url}/api/ledger/series`)).json()) as RecoveryPoint[];
  expect(series).toEqual(await recoverySeries());
  expect(series.reduce((n, p) => n + p.recovered, 0)).toBe(6.4);
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

test("real portal, email, and fax adapters run end to end through the PBM Sim doors", async () => {
  config.adapterMode = "real";
  try {
    expect(await run("RXS-REAL-0001", "RXS-0001")).toBe("SETTLED");
    expect(await run("RXS-REAL-0002", "RXS-0002")).toBe("SETTLED");
    expect(await run("RXS-REAL-0003", "RXS-0003")).toBe("SETTLED");
  } finally {
    config.adapterMode = "direct";
  }
});

test("expanded 60-claim seed reaches terminal outcomes through the switch and API over HTTP", async () => {
  const claimIds: string[] = [];
  for (const [index, claim] of seedClaims.entries()) {
    const claimId = `RXS-${1_000_000 + index}`;
    claimIds.push(claimId);
    const response = await fetch(`${sim.url}/switch/claim`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ transaction: "B1", meta: { ...claim.meta, claim_id: claimId }, request: claim.request }),
    });
    expect(response.status).toBe(200);
    const result = await response.json() as { response: Record<string, unknown> };
    expect(result.response["112-AN"]).toBe("P");
  }

  let processed = await getDb().claims.find({ pharmacy_id: config.pharmacyId });
  for (let attempt = 0; attempt < 1000; attempt++) {
    processed = await getDb().claims.find({ pharmacy_id: config.pharmacyId });
    if (processed.length === 60 && processed.every((claim) => claim.stage && TERMINAL_STAGES.includes(claim.stage))) break;
    await Bun.sleep(10);
  }
  expect(processed).toHaveLength(60);
  expect(processed.every((claim) => claim.stage && TERMINAL_STAGES.includes(claim.stage))).toBe(true);
  expect(processed.every((claim) => claimIds.includes(claim.claim_id))).toBe(true);
  const latestServiceDate = new Date().toISOString().slice(0, 10);
  expect(processed.every((claim) => /^\d{4}-\d{2}-\d{2}$/.test(claim.fill_date) && claim.fill_date <= latestServiceDate)).toBe(true);
  const appealable = processed.filter((claim) => claim.verdict?.verdict !== "CLEAR");
  expect(appealable.every((claim) => claim.verdict?.appeal_deadline !== null && claim.verdict?.appeal_deadline !== undefined && claim.verdict.appeal_deadline >= claim.fill_date)).toBe(true);

  const verdictCounts = { CLEAR: 0, UNDERWATER: 0, MARGINAL: 0 };
  for (const claim of processed) verdictCounts[claim.verdict!.verdict]++;
  expect(verdictCounts).toEqual({ CLEAR: 39, UNDERWATER: 18, MARGINAL: 3 });
});
