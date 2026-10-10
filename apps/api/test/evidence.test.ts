/** AGT-02: real appeal PDFs, extraction with fixture fallback, completeness against the PBM spec. */
import { afterEach, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Claim, Verdict } from "@rxsolve/contracts";
import { config } from "../src/config";
import { buildEvidence, withDocument } from "../src/agents/evidence";
import { statute } from "../src/reference";

const claim = (state: string, over: Partial<Claim> = {}): Claim =>
  ({
    claim_id: `E-${state}`, pharmacy_id: "PH-X", pbm: "PBM_PORTAL", state, plan: `${state} Plan`, patient_ref: "PT-1",
    ndc: "00378001801", qty: 1000, fill_date: "2026-10-01", paid_amount: 6.4, acquisition_cost: 12.8, nadac: 9, contract_rate: 9.5,
    ncpdp: { request: { "402-D2": "RX778812" }, response: {} },
    ...over,
  }) as unknown as Claim;
const verdict = (id: string): Verdict =>
  ({ claim_id: id, verdict: "UNDERWATER", delta: 6.4, benchmark_used: "acquisition_cost", appeal_deadline: "2026-10-12", confidence: 0.97 });

const key = config.agentApiKey;
config.databaseUrl = "";
afterEach(() => {
  config.agentApiKey = key;
  config.databaseUrl = "";
});
const dir = () => mkdtempSync(join(tmpdir(), "rxs-ev-"));
const text = async (d: string, name: string) => Buffer.from(await Bun.file(join(d, name)).arrayBuffer()).toString("latin1");

test.each(["TN", "NC", "GA", "ZZ"])("%s: PDFs carry the citation, invoice line and claim facts", async (state) => {
  config.agentApiKey = "";
  const d = dir();
  const c = claim(state);
  const ev = await buildEvidence(c, verdict(c.claim_id), { outDir: d });
  const law = statute(state);
  expect(ev.statute).toBe(law.citation);
  expect(ev.entitlement).toBe(law.entitlement);
  expect(ev.attachments).toEqual([`wholesaler_invoice_${c.claim_id}.pdf`, `appeal_${c.claim_id}.pdf`]);

  const appeal = await text(d, `appeal_${c.claim_id}.pdf`);
  expect(appeal.startsWith("%PDF-1.4")).toBe(true);
  expect(appeal.trimEnd().endsWith("%%EOF")).toBe(true);
  expect(appeal).toContain("INV-55120");
  expect(appeal).toContain("RX778812");
  expect(appeal).toContain("Underpayment $6.40");
  expect(appeal).toContain(law.citation.slice(0, 20).replace(/([()\\])/g, "\\$1"));
  expect(await text(d, `wholesaler_invoice_${c.claim_id}.pdf`)).toContain("Extended $12.80");
});

test("GA packet keeps the honest entitlement text", async () => {
  config.agentApiKey = "";
  const ev = await buildEvidence(claim("GA"), verdict("E-GA"), { outDir: dir() });
  expect(ev.entitlement).toContain("does not mention acquisition cost");
});

test("completeness is scored against the target PBM spec", async () => {
  config.agentApiKey = "";
  const full = await buildEvidence(claim("NC"), verdict("E-NC"), { outDir: dir() });
  expect(full.completeness).toBe(1);
  expect(full.required_fields_present).toContain("invoice_number");

  const noRx = claim("NC", { ncpdp: undefined });
  const partial = await buildEvidence(noRx, verdict("E-NC"), { outDir: dir() });
  expect(partial.completeness).toBeCloseTo(5 / 6);
  expect(partial.required_fields_present).not.toContain("rx_number");

  const fax = await buildEvidence(claim("NC", { pbm: "PBM_FAX" } as never), verdict("E-NC"), { outDir: dir() });
  expect(fax.spec_version).toBe("pbm_fax@2026-10-10");
  expect(fax.completeness).toBe(1);
});

test("state extras (TN wholesaler attestation) block completeness until supplied", async () => {
  config.agentApiKey = "";
  const rules = { TN: ["wholesaler_attestation"] };
  const d = dir();
  const ev = await buildEvidence(claim("TN"), verdict("E-TN"), { outDir: d, stateRules: rules });
  expect(ev.completeness).toBeLessThan(1);
  expect(ev.required_fields_present).not.toContain("wholesaler_attestation");
  expect(await text(d, "appeal_E-TN.pdf")).toContain("MISSING \\(not ready to file\\): wholesaler_attestation");

  const fixed = withDocument(ev, "PBM_PORTAL", "wholesaler_attestation", "ATT-1", rules);
  expect(fixed.completeness).toBe(1);
  expect(fixed.required_fields_present).toContain("wholesaler_attestation");
});

test("no invoice line: no invoice attachment and incomplete", async () => {
  config.agentApiKey = "";
  const ev = await buildEvidence(claim("TN", { ndc: "99999999999" }), verdict("E-TN"), { outDir: dir() });
  expect(ev.completeness).toBeLessThan(1);
  expect(ev.attachments).toEqual(["appeal_E-TN.pdf"]);
});

test("model extraction is used when a key is set; errors fall back to the fixture", async () => {
  config.agentApiKey = "test-key";
  const prompts: string[] = [];
  const ok = (async (_s: unknown, p: string) => {
    prompts.push(p);
    return { entitlement: "Model-extracted entitlement.", requires_acquisition_cost_floor: true };
  }) as never;
  const ev = await buildEvidence(claim("TN"), verdict("E-TN"), { outDir: dir(), ask: ok });
  expect(ev.entitlement).toBe("Model-extracted entitlement.");
  expect(ev.statute).toBe(statute("TN").citation); // citation never comes from the model
  expect(prompts[0]).toContain(statute("TN").entitlement);

  const boom = (async () => {
    throw new Error("model down");
  }) as never;
  const fb = await buildEvidence(claim("TN"), verdict("E-TN"), { outDir: dir(), ask: boom });
  expect(fb.entitlement).toBe(statute("TN").entitlement);

  const lies = (async () => ({ entitlement: "Pays acquisition cost.", requires_acquisition_cost_floor: true })) as never;
  const ga = await buildEvidence(claim("GA"), verdict("E-GA"), { outDir: dir(), ask: lies });
  expect(ga.entitlement).toBe(statute("GA").entitlement);
});

test("no key means no model call", async () => {
  config.agentApiKey = "";
  const ask = (async () => {
    throw new Error("should not be called");
  }) as never;
  const ev = await buildEvidence(claim("NC"), verdict("E-NC"), { outDir: dir(), ask });
  expect(ev.entitlement).toBe(statute("NC").entitlement);
});
