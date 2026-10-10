/** Pharmacist notifier (AGT-07): digest, exception pings, reply commands. No network, no creds. */
import { afterEach, beforeEach, expect, test } from "bun:test";
import type { Claim, Evidence } from "@rxsolve/contracts";
import { handleReply, raiseException, sendDigest, setRefileHandler, summarizeDay } from "../src/agents/notifier";
import { config } from "../src/config";
import { getDb, resetDb, type ClaimRecord } from "../src/db";
import { resetLedger } from "../src/ledger";
import { senderAllowed } from "../src/messaging/spectrum";
import { allows, getPolicy } from "../src/policy";

const PH = "PH-TEST";
const now = () => new Date().toISOString();

const claim = (id: string, over: Partial<ClaimRecord> = {}): ClaimRecord => ({
  claim_id: id, pharmacy_id: PH, pbm: "PBM_PORTAL", state: "TN", plan: "P", patient_ref: "pt",
  ndc: "00000-0000-00", qty: 30, fill_date: "2026-10-10", paid_amount: 10, acquisition_cost: 130,
  nadac: null, contract_rate: null, ...over,
});
const verdict = (id: string, delta: number) =>
  ({ claim_id: id, verdict: "UNDERWATER" as const, delta, benchmark_used: "acq", appeal_deadline: null, confidence: 1 });
const evidence = (id: string, delta: number, completeness = 1): Evidence => ({
  claim_id: id, statute: "s", entitlement: "e", attachments: [], required_fields_present: [],
  spec_version: "1", completeness, fields: {}, delta, appeal_deadline: null,
});

async function seedException(id: string, delta: number, completeness = 1) {
  const db = getDb();
  await db.claims.insert(claim(id, { stage: "EXCEPTION", reason: "over limit", verdict: verdict(id, delta) }));
  await db.evidence.insert(evidence(id, delta, completeness));
  await db.audit.insert({ claim_id: id, ts: now(), stage: "EXCEPTION" });
}

let refiled: string[] = [];
let saved = { ...config };
afterEach(() => {
  Object.assign(config, saved);
  setRefileHandler(null);
});

beforeEach(() => {
  saved = { ...config };
  resetDb();
  resetLedger();
  Object.assign(config, { databaseUrl: "", ledgerBackend: "local", photonProjectId: "", elevenlabsApiKey: "", pharmacistPhone: "" });
  refiled = [];
  setRefileHandler(async (id) => { refiled.push(id); });
});

test("digest is built from audit and remittance data", async () => {
  const db = getDb();
  await db.claims.insert(claim("RXS-1", { stage: "SETTLED", verdict: verdict("RXS-1", 40) }));
  await db.claims.insert(claim("RXS-2", { stage: "FILED", verdict: verdict("RXS-2", 20) }));
  await db.claims.insert(claim("RXS-3", { stage: "CLEARED" }));
  for (const [id, stage] of [["RXS-1", "DETECTED"], ["RXS-1", "FILED"], ["RXS-2", "FILED"], ["RXS-3", "CLEARED"]] as const)
    await db.audit.insert({ claim_id: id, ts: now(), stage });
  await db.remittances.insert({
    remittance_id: "REM-1", type: "835-style", payer: "PBM", payee: PH, claim_id: "RXS-1", paid_original: 10,
    adjustment: 40, paid_total: 50, reason: "r", posted_at: now(),
  });
  await db.remittances.insert({
    remittance_id: "REM-OLD", type: "835-style", payer: "PBM", payee: PH, claim_id: "RXS-0", paid_original: 10,
    adjustment: 5, paid_total: 15, reason: "r", posted_at: new Date(Date.now() - 3 * 86_400_000).toISOString(),
  });

  const s = await summarizeDay(PH);
  expect(s).toMatchObject({ found: 2, found_amt: 60, filed: 2, pending: 1, recovered: 40, week_recovered: 45 });

  config.pharmacyId = PH;
  const msg = await sendDigest(PH);
  expect(msg.channel).toBe("imessage");
  expect(msg.text).toContain("found 2 underpaid claims ($60.00)");
  expect(msg.text).toContain("recovered $40.00");
  expect(msg.text).toContain("This week: $45.00");
  expect(msg.meta.delivered).toBeUndefined(); // no creds: recorded for the dashboard only
});

test("exception ping carries claim, amount, and an APPROVE ask for policy exceptions", async () => {
  await seedException("RXS-6", 120);
  const m = await raiseException(claim("RXS-6") as Claim, "$120.00 is over the $100 auto-file limit");
  expect(m.claim_id).toBe("RXS-6");
  expect(m.text).toContain("($120.00 short)");
  expect(m.text).toContain("Reply APPROVE RXS-6 to file or SKIP RXS-6.");

  const inc = await raiseException(claim("RXS-7") as Claim, "evidence incomplete (60%)");
  expect(inc.text).not.toContain("APPROVE");
});

test("APPROVE records a one-off authorization and re-runs the claim", async () => {
  await seedException("RXS-6", 120);
  const c = (await getDb().claims.get("RXS-6"))!;
  expect((await allows(c, evidence("RXS-6", 120))).ok).toBe(false);

  const reply = await handleReply("approve", PH); // sole pending exception needs no id
  expect(reply).toContain("Approved RXS-6");
  expect(refiled).toEqual(["RXS-6"]);
  expect((await allows(c, evidence("RXS-6", 120))).ok).toBe(true);
  expect((await getPolicy(PH)).approved_claims).toEqual(["RXS-6"]);
});

test("APPROVE with several pending asks which, and refuses incomplete evidence", async () => {
  await seedException("RXS-6", 120);
  await seedException("RXS-8", 150, 0.5);
  expect(await handleReply("APPROVE", PH)).toContain("Which claim?");
  expect(await handleReply("APPROVE RXS-8", PH)).toContain("cannot be filed");
  expect(refiled).toEqual([]);
  expect((await getPolicy(PH)).approved_claims ?? []).toEqual([]);
});

test("SKIP abandons the claim", async () => {
  await seedException("RXS-6", 120);
  expect(await handleReply("SKIP RXS-6", PH)).toContain("Skipped RXS-6");
  expect((await getDb().claims.get("RXS-6"))?.stage).toBe("ABANDONED");
});

test("PAUSE, RESUME and LIMIT change the standing authorization", async () => {
  const c = claim("RXS-9");
  await handleReply("PAUSE", PH);
  expect((await getPolicy(PH)).paused).toBe(true);
  expect((await allows(c, evidence("RXS-9", 10))).ok).toBe(false);

  await handleReply("resume", PH);
  expect((await allows(c, evidence("RXS-9", 10))).ok).toBe(true);

  expect(await handleReply("LIMIT $250", PH)).toContain("$250.00");
  expect((await getPolicy(PH)).auto_file_max).toBe(250);
  expect((await allows(c, evidence("RXS-9", 200))).ok).toBe(true);
  expect(await handleReply("LIMIT abc", PH)).toContain("Reply LIMIT");
});

test("DETAILS answers from claim data and unknown text gets a ledger status", async () => {
  await seedException("RXS-6", 120);
  expect(await handleReply("DETAILS RXS-6", PH)).toContain("short $120.00");
  expect(await handleReply("DETAILS", PH)).toContain("1 flagged");
  expect(await handleReply("how are we doing?", PH)).toContain("Recovered $0.00 to date");
});

test("only the configured pharmacist handle may command the notifier", () => {
  expect(senderAllowed("+1 (555) 010-2000", "+15550102000")).toBe(true);
  expect(senderAllowed("+15559999999", "+15550102000")).toBe(false);
  expect(senderAllowed("Me@Example.com", "me@example.com")).toBe(true);
  expect(senderAllowed("anyone", "")).toBe(true);
  expect(senderAllowed("", "+15550102000")).toBe(false);
});
