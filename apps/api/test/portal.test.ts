/** AGT-03: PortalAdapter scripted driver against a fake local portal door (no network, no browser). */
import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Claim, Evidence, Ticket } from "@rxsolve/contracts";
import { config } from "../src/config";
import { getDb } from "../src/db";
import { PortalAdapter, fieldMap, parseStatus } from "../src/adapters/portal";

config.databaseUrl = "";

type D = { status: string; reason?: string; field?: string; delta?: string; message?: string };
const seen: { path: string; fields: Record<string, string>; files: string[] }[] = [];
let decision: D = { status: "DENIED", reason: "missing_field", field: "invoice_number", message: "Appeal denied: required documentation missing (invoice number)." };
let server: ReturnType<typeof Bun.serve>;
let base = "";

const page = (t: string, d: D) =>
  `<html><body><div id="status" data-ticket="${t}" data-status="${d.status}" data-submitted-at="2026-10-10T10:00:00.000Z" data-expected-by="2026-10-10T10:00:02.000Z" data-reason="${d.reason ?? ""}" data-field="${d.field ?? ""}" data-delta="${d.delta ?? ""}"></div><p id="message">${d.message ?? "Under review"}</p></body></html>`;

beforeAll(() => {
  server = Bun.serve({
    port: 0,
    async fetch(req) {
      const u = new URL(req.url);
      if (req.method === "POST") {
        const f = await req.formData();
        const fields: Record<string, string> = {};
        const files: string[] = [];
        for (const [k, v] of f.entries()) {
          if (typeof v === "string") fields[k] = v;
          else files.push(v.name);
        }
        seen.push({ path: u.pathname, fields, files });
        const t = u.pathname.includes("/reply") ? u.pathname.split("/")[4]! : "PRT-0001";
        return new Response(null, { status: 303, headers: { location: `/portal/PBM_PORTAL/status/${t}` } });
      }
      const t = u.pathname.split("/").pop()!;
      return new Response(page(t, t === "PRT-PENDING" ? { status: "PENDING" } : decision));
    },
  });
  base = `http://localhost:${server.port}`;
});
afterAll(() => server.stop(true));

const claim = { claim_id: "C-1", pbm: "PBM_PORTAL", state: "TN" } as unknown as Claim;
const ticket = (id: string): Ticket =>
  ({ claim_id: "C-1", pbm: "PBM_PORTAL", channel: "portal", ticket_id: id, submitted_at: "2026-10-10T10:00:00.000Z", expected_response_by: "2026-10-10T10:00:02.000Z" }) as Ticket;
const ev = (): Evidence => ({
  claim_id: "C-1", statute: "Tenn. Code 56-7-3109", entitlement: "x", attachments: ["appeal_C-1.pdf", "missing_C-1.pdf"],
  required_fields_present: [], spec_version: "pbm_portal@2026-10-10", completeness: 1,
  fields: { ndc: "00378001801", rx_number: "RX778812", fill_date: "2026-10-01", acquisition_cost: 12.8, state: "TN", nested: { a: 1 } },
  delta: 6.4, appeal_deadline: null,
});

const dir = mkdtempSync(join(tmpdir(), "rxs-portal-"));
writeFileSync(join(dir, "appeal_C-1.pdf"), "%PDF-1.4 test");
const adapter = () => new PortalAdapter({ mode: "scripted", baseUrl: base, evidenceDir: dir });

test("fieldMap uses spec field names, skips non-scalars, adds routing fields", () => {
  const m = fieldMap("PBM_PORTAL", ev());
  expect(m.ndc).toBe("00378001801");
  expect(m.acquisition_cost).toBe("12.8");
  expect(m.nested).toBeUndefined();
  expect(m.invoice_number).toBeUndefined();
  expect(m).toMatchObject({ claim_id: "C-1", state: "TN", delta: "6.40" });
});

test("parseStatus reads the status block", () => {
  const s = parseStatus(page("T1", { status: "APPROVED", delta: "6.40", message: "ok" }), "T1");
  expect(s).toMatchObject({ status: "APPROVED", delta: 6.4, reason: null, field: null });
  expect(() => parseStatus("<html></html>", "T")).toThrow();
});

test("submit fills the form, uploads the PDFs, records a transcript line", async () => {
  const t = await adapter().submit(claim, ev());
  expect(t).toMatchObject({ claim_id: "C-1", channel: "portal", ticket_id: "PRT-0001", submitted_at: "2026-10-10T10:00:00.000Z" });
  const post = seen.at(-1)!;
  expect(post.path).toBe("/portal/PBM_PORTAL/appeal");
  expect(post.fields.rx_number).toBe("RX778812");
  expect(post.files).toEqual(["appeal_C-1.pdf", "missing_C-1.pdf"]);
  const rows = await getDb().transcript.find({ claim_id: "C-1" });
  expect(rows.some((r) => r.direction === "out" && r.text.includes("Portal form filed"))).toBe(true);
});

test("poll returns null while pending and a Decision once decided", async () => {
  const a = adapter();
  expect(await a.poll(ticket("PRT-PENDING"))).toBeNull();
  const d = await a.poll(ticket("PRT-0001"));
  expect(d).toMatchObject({ status: "DENIED", reason: "missing_field", field: "invoice_number", delta: null });
  expect(d!.raw).toContain("invoice number");
  decision = { status: "APPROVED", delta: "6.40", message: "Approved" };
  expect(await a.poll(ticket("PRT-0001"))).toMatchObject({ status: "APPROVED", reason: null, delta: 6.4 });
  const rows = await getDb().transcript.find({ claim_id: "C-1" });
  expect(rows.filter((r) => r.direction === "in").length).toBe(2);
});

test("reply posts to the message center and keeps the ticket", async () => {
  const t = await adapter().reply(ticket("PRT-0001"), { evidence: ev(), note: "Invoice attached" });
  expect(t.ticket_id).toBe("PRT-0001");
  const post = seen.at(-1)!;
  expect(post.path).toBe("/portal/PBM_PORTAL/status/PRT-0001/reply");
  expect(post.fields.note).toBe("Invoice attached");
});
