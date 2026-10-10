/** AGT-05: FaxAdapter against a fake local fax line; no network, no model. */
import { afterAll, beforeAll, beforeEach, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Claim, Evidence } from "@rxsolve/contracts";
import { FaxAdapter } from "../src/adapters/fax";
import { pdfText } from "../src/adapters/fax-pdf";
import { readFaxReply } from "../src/adapters/fax-read";
import { renderPdf } from "../src/agents/pdf";
import { config } from "../src/config";
import { getDb, resetDb } from "../src/db";

const claim = { claim_id: "F-1", pharmacy_id: "PH-X", pbm: "PBM_FAX", state: "NC", plan: "NC Plan", patient_ref: "PT-1" } as unknown as Claim;
const ev = (over: Record<string, unknown> = {}): Evidence => ({
  claim_id: "F-1", statute: "N.C. Gen. Stat. 58-56A-5", entitlement: "MAC appeal", attachments: ["appeal_F-1.pdf"],
  required_fields_present: [], spec_version: "v1", completeness: 1, fields: { state: "NC", ndc: "00378001801", ...over }, delta: 6.4, appeal_deadline: null,
});

let received: { path: string; headers: Headers; body: Uint8Array }[] = [];
let replies: Record<string, string[] | null> = {};
let server: ReturnType<typeof Bun.serve>;
const dir = mkdtempSync(join(tmpdir(), "rxs-fax-"));

beforeAll(() => {
  server = Bun.serve({
    port: 0,
    async fetch(req) {
      const u = new URL(req.url);
      if (req.method === "POST") {
        received.push({ path: u.pathname, headers: req.headers, body: new Uint8Array(await req.arrayBuffer()) });
        const id = req.headers.get("x-ticket-id") ?? `OPT-${received.length}`;
        return Response.json({ ticket_id: id, submitted_at: "2026-10-10T10:00:00Z", expected_response_by: "2026-10-10T10:01:00Z" });
      }
      const id = u.pathname.split("/").pop()!;
      const lines = replies[id];
      if (lines === undefined) return new Response("no", { status: 404 });
      if (lines === null) return new Response(null, { status: 202 });
      return new Response(renderPdf(lines, "reply"), { headers: { "content-type": "application/pdf" } });
    },
  });
  config.pbmSimUrl = `http://localhost:${server.port}`;
});
afterAll(() => server.stop(true));
beforeEach(async () => {
  config.databaseUrl = "";
  config.agentApiKey = "";
  received = [];
  replies = {};
  await resetDb();
});

test("submit posts a cover sheet and evidence PDF and records the exchange", async () => {
  const t = await new FaxAdapter(dir).submit(claim, ev());
  expect(t).toMatchObject({ claim_id: "F-1", pbm: "PBM_FAX", channel: "fax", ticket_id: "OPT-1" });
  expect(received[0]!.path).toBe("/fax/PBM_FAX");
  expect(received[0]!.headers.get("content-type")).toBe("application/pdf");
  const text = pdfText(received[0]!.body).join("\n");
  expect(text).toContain("FAX COVER SHEET");
  expect(text).toContain("ndc: 00378001801");
  expect(text).toContain("EVIDENCE");
  const msgs = await getDb().transcript.find({ claim_id: "F-1" });
  expect(msgs).toHaveLength(1);
  expect(msgs[0]).toMatchObject({ channel: "fax", direction: "out" });
});

test("poll returns null while pending, then a denial read from the reply PDF", async () => {
  const a = new FaxAdapter(dir);
  const t = await a.submit(claim, ev());
  replies[t.ticket_id] = null;
  expect(await a.poll(t)).toBeNull();
  replies[t.ticket_id] = ["OPTUM RETURN FAX", "Appeal denied: required documentation missing (acquisition cost)."];
  const d = await a.poll(t);
  expect(d).toMatchObject({ status: "DENIED", reason: "missing_field", field: "acquisition_cost", delta: null, ticket_id: t.ticket_id });
  expect((await getDb().transcript.find({ claim_id: "F-1" })).map((m) => m.direction)).toEqual(["out", "in"]);
});

test("reply refiles on the same ticket and the approval carries the amount", async () => {
  const a = new FaxAdapter(dir);
  const t = await a.submit(claim, ev());
  const next = await a.reply(t, { evidence: ev({ acquisition_cost: 12.8 }), note: "Rebuttal with invoice" });
  expect(next.ticket_id).toBe(t.ticket_id);
  expect(received[1]!.headers.get("x-ticket-id")).toBe(t.ticket_id);
  expect(pdfText(received[1]!.body).join("\n")).toContain("RE: ticket");
  replies[t.ticket_id] = ["MAC appeal approved. Adjustment $6.40 will post on the next remittance."];
  expect(await a.poll(next)).toMatchObject({ status: "APPROVED", reason: null, delta: 6.4 });
});

test("a model error falls back to the text layer", async () => {
  config.agentApiKey = "sk-test";
  const d = await readFaxReply(renderPdf(["Appeal denied: disputed rate."], "r"), async () => {
    throw new Error("boom");
  });
  expect(d).toMatchObject({ status: "DENIED", reason: "disputed" });
});

test("an unreadable reply throws", async () => {
  await expect(readFaxReply(renderPdf(["lorem ipsum"], "r"))).rejects.toThrow();
});
