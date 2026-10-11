/** AGT-06: negotiation loop through the direct and fax adapters against fake doors; no network, model stubbed. */
import { afterAll, beforeAll, beforeEach, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Action, Claim, Decision, Evidence, Verdict } from "@rxsolve/contracts";
import type { ChannelAdapter } from "../src/adapters";
import { DirectAdapter } from "../src/adapters/direct";
import { FaxAdapter } from "../src/adapters/fax";
import { pdfText } from "../src/adapters/fax-pdf";
import { buildEvidence } from "../src/agents/evidence";
import { MAX_REMEDIATIONS, onDenial, resetNegotiation, type NegotiationOpts } from "../src/agents/negotiation";
import { renderPdf } from "../src/agents/pdf";
import { parseReply, quoteSupports, readReply, requestDocument, wholesalerConfig } from "../src/agents/wholesaler";
import { config } from "../src/config";
import { getDb, resetDb } from "../src/db";

const claim = {
  claim_id: "RXS-0901", pharmacy_id: "PH-X", pbm: "PBM_PORTAL", state: "TN", plan: "TN Plan", patient_ref: "PT-1",
  ndc: "00378001801", qty: 1000, fill_date: "2026-10-01", paid_amount: 6.4, acquisition_cost: 12.8, nadac: 9, contract_rate: 9.5,
  ncpdp: { request: { "402-D2": "RX778812" }, response: {} },
} as unknown as Claim;
const faxClaim = { ...claim, claim_id: "RXS-0902", pbm: "PBM_FAX" } as Claim;
const verdict = (c: Claim): Verdict => ({ claim_id: c.claim_id, verdict: "UNDERWATER", delta: 6.4, benchmark_used: "acquisition_cost", appeal_deadline: "2099-01-01", confidence: 1 });

type Mode = "attest" | "stuck" | "dispute" | "dispute-always";
let mode: Mode = "attest";
let rounds: Record<string, number> = {};
let replies: { id: string; note: string; hasAtt: boolean }[] = [];
let faxPdfs: Record<string, string[]> = {};
let server: ReturnType<typeof Bun.serve>;
const dir = mkdtempSync(join(tmpdir(), "rxs-neg-"));

/** The fake PBM's rule: deterministic, never a model. */
function decide(id: string, hasAtt: boolean, isReply: boolean, note = "") {
  const round = (rounds[id] = (rounds[id] ?? -1) + 1);
  if (isReply) replies.push({ id, note, hasAtt });
  if (mode === "stuck") return { status: "DENIED", reason: "missing_field", field: "wholesaler_attestation", message: "Appeal denied: required documentation missing (wholesaler attestation)." };
  if (mode === "dispute-always" || (mode === "dispute" && round === 0)) return { status: "DENIED", reason: "disputed", message: "Appeal denied: disputed rate." };
  if (mode === "attest" && !hasAtt) return { status: "DENIED", reason: "missing_field", field: "wholesaler_attestation", message: "Appeal denied: required documentation missing (wholesaler attestation)." };
  return { status: "APPROVED", delta: 6.4, message: "MAC appeal approved. Adjustment $6.40 will post on the next remittance." };
}

beforeAll(() => {
  let n = 0;
  const results: Record<string, ReturnType<typeof decide>> = {};
  server = Bun.serve({
    port: 0,
    async fetch(req) {
      const u = new URL(req.url);
      const parts = u.pathname.split("/").filter(Boolean);
      const t = { submitted_at: "2026-10-10T10:00:00Z", expected_response_by: "2026-10-10T10:01:00Z" };
      if (parts[0] === "dev") {
        if (req.method === "GET") return Response.json(results[parts[2]!] ?? { status: "PENDING" });
        const body = (await req.json()) as { fields: Record<string, unknown> };
        const id = parts[3] === "reply" ? parts[2]! : `DEV-${++n}`;
        results[id] = decide(id, Boolean(body.fields.wholesaler_attestation), parts[3] === "reply");
        return Response.json({ ticket_id: id, ...t });
      }
      if (req.method === "POST") {
        const text = pdfText(new Uint8Array(await req.arrayBuffer()));
        const id = req.headers.get("x-ticket-id") ?? `FAX-${++n}`;
        const r = decide(id, /wholesaler_attestation: ATT-/.test(text.join("\n")), req.headers.has("x-ticket-id"), text.join("\n"));
        results[id] = r;
        faxPdfs[id] = text;
        return Response.json({ ticket_id: id, ...t });
      }
      const r = results[parts[parts.length - 1]!];
      if (!r) return new Response(null, { status: 202 });
      return new Response(renderPdf(["PBM RETURN FAX", r.message], "reply"), { headers: { "content-type": "application/pdf" } });
    },
  });
  config.pbmSimUrl = `http://localhost:${server.port}`;
});
afterAll(() => server.stop(true));
beforeEach(async () => {
  Object.assign(config, { databaseUrl: "", agentApiKey: "", photonProjectId: "", photonProjectSecret: "", wholesalerContact: "", pollIntervalMs: 5 });
  Object.assign(wholesalerConfig, { stub: "auto", timeoutMs: 500 });
  mode = "attest";
  rounds = {};
  replies = [];
  faxPdfs = {};
  resetNegotiation();
  await resetDb();
});

async function drive(adapter: ChannelAdapter, c: Claim, opts: NegotiationOpts = {}, ev0?: Evidence) {
  let evidence = ev0 ?? (await buildEvidence(c, verdict(c), { outDir: dir }));
  let ticket = await adapter.submit(c, evidence);
  const decisions: Decision[] = [];
  const actions: Action[] = [];
  for (let round = 0; round < 6; round++) {
    let d: Decision | null = null;
    for (let i = 0; i < 200 && !d; i++) d = await adapter.poll(ticket);
    if (!d) throw new Error("no decision");
    decisions.push(d);
    if (d.status === "APPROVED") return { decisions, actions, evidence, status: "APPROVED" as const };
    const a = await onDenial(c, evidence, d, adapter, ticket, { ...opts, build: { outDir: dir, ...opts.build } });
    actions.push(a);
    if (a.kind !== "REFILED") return { decisions, actions, evidence, status: a.kind };
    ticket = a.ticket!;
    evidence = a.evidence ?? evidence;
  }
  throw new Error("did not terminate");
}

const head = async (name: string) => Buffer.from(await Bun.file(join(dir, name)).arrayBuffer()).subarray(0, 5).toString();

test("direct adapter: missing attestation -> wholesaler -> real PDF -> refile -> approved", async () => {
  const r = await drive(new DirectAdapter("portal"), claim);
  expect(r.decisions.map((d) => d.status)).toEqual(["DENIED", "APPROVED"]);
  expect(r.decisions[0]).toMatchObject({ reason: "missing_field", field: "wholesaler_attestation" });
  expect(r.actions[0]!.kind).toBe("REFILED");
  const name = "wholesaler_attestation_RXS-0901.pdf";
  expect(r.actions[0]!.evidence!.attachments).toContain(name);
  expect(await head(name)).toBe("%PDF-");
  expect(r.actions[0]!.evidence!.fields.wholesaler_attestation).toBe("ATT-0901");

  const t = await getDb().transcript.find({ claim_id: claim.claim_id });
  const w = t.filter((m) => m.counterparty === "wholesaler");
  expect(w.map((m) => [m.channel, m.direction])).toEqual([["whatsapp", "out"], ["whatsapp", "in"]]);
});

test("fax adapter: same loop, the rebuilt packet carries the wholesaler document text", async () => {
  const r = await drive(new FaxAdapter(dir), faxClaim);
  expect(r.status).toBe("APPROVED");
  expect(r.decisions.map((d) => d.reason)).toEqual(["missing_field", null]);
  const refile = replies[0]!;
  expect(refile.hasAtt).toBe(true);
  expect(refile.note).toContain("WHOLESALER DOCUMENT: wholesaler attestation");
  expect(refile.note).toContain("ATT-0902");
});

test("the rebuilt appeal PDF stops listing the field as missing", async () => {
  const build = { outDir: dir, stateRules: { TN: ["wholesaler_attestation"] } };
  const ev = await buildEvidence({ ...claim, claim_id: "RXS-0903" } as Claim, verdict(claim), build);
  const read = async () => Buffer.from(await Bun.file(join(dir, "appeal_RXS-0903.pdf")).arrayBuffer()).toString("latin1");
  expect(ev.completeness).toBeLessThan(1);
  expect(await read()).toContain("MISSING");
  const c = { ...claim, claim_id: "RXS-0903" } as Claim;
  const adapter = new DirectAdapter("portal");
  const ticket = await adapter.submit(c, ev);
  const d: Decision = { claim_id: c.claim_id, ticket_id: ticket.ticket_id, status: "DENIED", reason: "missing_field", field: "wholesaler_attestation", delta: null, raw: null };
  const a = await onDenial(c, ev, d, adapter, ticket, { build });
  expect(a.kind).toBe("REFILED");
  expect(a.evidence!.completeness).toBe(1);
  expect(await read()).toContain("Missing: none");
});

test("wholesaler never replies: abandoned, logged, nothing refiled", async () => {
  Object.assign(wholesalerConfig, { stub: "silent", timeoutMs: 40 });
  const r = await drive(new DirectAdapter("portal"), claim);
  expect(r.status).toBe("ABANDONED");
  expect(r.actions[0]!.reason).toContain("wholesaler did not supply wholesaler_attestation");
  expect(replies).toHaveLength(0);
  const t = await getDb().transcript.find({ claim_id: claim.claim_id });
  expect(t.filter((m) => m.counterparty === "wholesaler" && m.direction === "in")).toHaveLength(0);
  expect(t.some((m) => m.channel === "imessage" && m.text.includes("abandoned"))).toBe(true);
});

test("a reply that refuses the document abandons", async () => {
  expect(parseReply("Sorry, we cannot provide that.", "wholesaler_attestation")).toBeNull();
  expect(parseReply("Attached: wholesaler attestation ATT-5512", "wholesaler_attestation")).toBe("ATT-5512");
});

test("bounded attempts: a PBM that keeps denying the field ends in ABANDONED after the cap", async () => {
  mode = "stuck";
  const r = await drive(new DirectAdapter("portal"), claim);
  expect(r.status).toBe("ABANDONED");
  expect(replies).toHaveLength(MAX_REMEDIATIONS);
  expect(r.actions.map((a) => a.kind)).toEqual(["REFILED", "REFILED", "ABANDONED"]);
  const asked = (await getDb().transcript.find({ claim_id: claim.claim_id })).filter((m) => m.counterparty === "wholesaler" && m.direction === "out");
  expect(asked).toHaveLength(MAX_REMEDIATIONS);
});

test("PBM_FAX disputed first, approved on rebuttal; the model words it but facts are guarded", async () => {
  mode = "dispute";
  const ev = await buildEvidence({ ...faxClaim, state: "NC" } as Claim, verdict(faxClaim), { outDir: dir });
  const ask = (async () => ({ text: `Under ${ev.statute} the $6.40 underpayment must be corrected.` })) as never;
  const r = await drive(new FaxAdapter(dir), { ...faxClaim, state: "NC" } as Claim, { ask }, ev);
  expect(r.decisions.map((d) => d.reason)).toEqual(["disputed", null]);
  expect(r.status).toBe("APPROVED");
  expect(replies[0]!.note).toContain("Note: Under N.C. Gen. Stat.");
  expect(replies[0]!.hasAtt).toBe(false);
});

test("a model rebuttal that drops the citation falls back to the template", async () => {
  mode = "dispute";
  const ask = (async () => ({ text: "Please pay us." })) as never;
  const r = await drive(new DirectAdapter("portal"), claim, { ask }, { ...(await buildEvidence(claim, verdict(claim), { outDir: dir })), fields: { ...{}, state: "TN", wholesaler_attestation: "ATT-1" } });
  expect(r.status).toBe("APPROVED");
  const out = (await getDb().transcript.find({ claim_id: claim.claim_id })).filter((m) => m.direction === "out" && m.counterparty === "PBM_PORTAL");
  expect(out.at(-1)!.text).toContain("supervisor review");
});

test("disputed again after the rebuttal escalates instead of looping", async () => {
  mode = "dispute-always";
  const r = await drive(new FaxAdapter(dir), faxClaim);
  expect(r.status).toBe("ESCALATED");
  expect(r.actions.map((a) => a.kind)).toEqual(["REFILED", "ESCALATED"]);
});

test("a passed appeal deadline files nothing and contacts no one", async () => {
  const adapter = new DirectAdapter("portal");
  const ev = { ...(await buildEvidence(claim, verdict(claim), { outDir: dir })), appeal_deadline: "2026-10-01" };
  const d: Decision = { claim_id: claim.claim_id, ticket_id: "T", status: "DENIED", reason: "missing_field", field: "wholesaler_attestation", delta: null, raw: null };
  const t = { claim_id: claim.claim_id, pbm: claim.pbm, channel: "portal", ticket_id: "T", submitted_at: "", expected_response_by: "" } as const;
  const a = await onDenial(claim, ev, d, adapter, t, { now: new Date("2026-10-10T00:00:00Z") });
  expect(a.kind).toBe("EXTERNAL_APPEAL");
  expect(await getDb().transcript.find({ claim_id: claim.claim_id })).toHaveLength(0);
});

test("auto wholesaler stub uses its known value without calling the model", async () => {
  let modelCalls = 0;
  const result = await requestDocument(claim, "wholesaler_attestation", {
    stub: "auto",
    ask: (async () => { modelCalls++; throw new Error("model should not read generated stub text"); }) as never,
  });
  expect(result).toMatchObject({ field: "wholesaler_attestation", value: "ATT-0901" });
  expect(modelCalls).toBe(0);
});

const reading = (r: { supplied: boolean; quote: string | null; value: string | null }) => (async () => r) as never;

test("model-first reply reading: bare invoice number in plain text", async () => {
  const text = "The invoice number is 55120";
  const v = await readReply(text, "invoice_number", reading({ supplied: true, quote: "55120", value: "INV-55120" }));
  expect(v).toBe("INV-55120");
  expect(parseReply(text, "invoice_number")).toBeNull();
});

test("model-first reply reading: date is normalized to ISO", async () => {
  const text = "inv 55120 dated Oct 1 2026";
  expect(await readReply(text, "invoice_number", reading({ supplied: true, quote: "inv 55120", value: "INV-55120" }))).toBe("INV-55120");
  expect(await readReply(text, "invoice_date", reading({ supplied: true, quote: "Oct 1 2026", value: "2026-10-01" }))).toBe("2026-10-01");
  expect(await readReply(text, "invoice_date", reading({ supplied: true, quote: "Oct 1 2026", value: "2026-10-02" }))).toBeNull();
});

test("model-first reply reading: a refusal is null even if the text has digits", async () => {
  const text = "We can't send that, invoice 4471 was voided";
  expect(await readReply(text, "invoice_number", reading({ supplied: false, quote: null, value: null }))).toBeNull();
});

test("model-first reply reading: a value absent from its quote falls back to the regex parse", async () => {
  const hallucinated = reading({ supplied: true, quote: "the invoice", value: "INV-99999" });
  expect(await readReply("Here you go: INV-55120", "invoice_number", hallucinated)).toBe("INV-55120");
  expect(await readReply("see attached", "invoice_number", hallucinated)).toBeNull();
  const badQuote = reading({ supplied: true, quote: "INV-77777", value: "INV-77777" });
  expect(await readReply("Here you go: INV-55120", "invoice_number", badQuote)).toBe("INV-55120");
});

test("model-first reply reading: with no key and no ask the regex parse runs; model errors fall back too", async () => {
  expect(await readReply("Invoice number is INV-55120", "invoice_number")).toBe("INV-55120");
  expect(await readReply("The invoice number is 55120", "invoice_number")).toBeNull();
  const boom = (async () => { throw new Error("down"); }) as never;
  expect(await readReply("Invoice INV-55120", "invoice_number", boom)).toBe("INV-55120");
});

test("quoteSupports checks cost and date tokens against the quote", () => {
  expect(quoteSupports("acquisition_cost", "10.5", "unit cost $10.50 each")).toBe(true);
  expect(quoteSupports("acquisition_cost", "11", "unit cost $10.50 each")).toBe(false);
  expect(quoteSupports("invoice_date", "2026-10-01", "10/01/2026")).toBe(true);
  expect(quoteSupports("invoice_date", "2026-10-01", "October 1st, 2026")).toBe(true);
  expect(quoteSupports("invoice_date", "2026-02-30", "Feb 30 2026")).toBe(false);
});
