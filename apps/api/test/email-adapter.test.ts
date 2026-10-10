/** EmailAdapter (AGT-04) against a fake local inbox door. No external network. */
import { afterAll, beforeAll, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Claim, Evidence } from "@rxsolve/contracts";
import { EmailAdapter, parseReply } from "../src/adapters/email";
import { config } from "../src/config";
import { getDb, resetDb } from "../src/db";

const dir = mkdtempSync(join(tmpdir(), "email-"));
writeFileSync(join(dir, "appeal_C1.pdf"), "%PDF-appeal");

let posts: any[] = [];
let replyBody: string | null = null;
let server: ReturnType<typeof Bun.serve>;
const saved = { ...config };

beforeAll(() => {
  server = Bun.serve({
    port: 0,
    async fetch(req) {
      const u = new URL(req.url);
      if (req.method === "POST" && u.pathname === "/inbox/PBM_EMAIL/messages") {
        posts.push(await req.json());
        return Response.json({ thread_id: "EML-0001", submitted_at: "2026-10-10T10:00:00Z", expected_response_by: "2026-10-10T10:00:03Z" });
      }
      if (u.pathname === "/inbox/PBM_EMAIL/replies/EML-0001")
        return replyBody === null ? new Response("", { status: 404 }) : Response.json({ subject: "Re: MAC appeal C1", body: replyBody });
      return new Response("nope", { status: 500 });
    },
  });
});
afterAll(() => { server.stop(true); Object.assign(config, saved); });
beforeEach(async () => {
  config.databaseUrl = "";
  await resetDb();
  posts = []; replyBody = null;
});

const claim = { claim_id: "C1", pbm: "PBM_EMAIL" } as Claim;
const ev: Evidence = {
  claim_id: "C1", statute: "TN 56-7-3101", entitlement: "e", attachments: ["appeal_C1.pdf", "gone_C1.pdf"],
  required_fields_present: [], spec_version: "1", completeness: 1, fields: { ndc: "00000-0000-00" }, delta: 12.5, appeal_deadline: null,
};
const adapter = () => new EmailAdapter({ baseUrl: `http://localhost:${server.port}`, attachmentDir: dir });

test("submit posts the appeal with the PDF attached and records it", async () => {
  const t = await adapter().submit(claim, ev);
  expect(t).toMatchObject({ ticket_id: "EML-0001", channel: "email", pbm: "PBM_EMAIL" });
  expect(posts[0].attachments).toHaveLength(1);
  expect(posts[0].attachments[0].filename).toBe("appeal_C1.pdf");
  expect(Buffer.from(posts[0].attachments[0].content_base64, "base64").toString()).toBe("%PDF-appeal");
  expect(posts[0].body).toContain("ndc: 00000-0000-00");
  const rows = await getDb().transcript.find({ claim_id: "C1" });
  expect(rows.length).toBe(1);
  expect(rows[0]?.direction).toBe("out");
});

test("poll returns null while pending, then approval", async () => {
  const a = adapter();
  const t = await a.submit(claim, ev);
  expect(await a.poll(t)).toBeNull();
  replyBody = "Status: APPROVED\nApproved amount: $12.50\n";
  const d = await a.poll(t);
  expect(d).toMatchObject({ status: "APPROVED", delta: 12.5, reason: null });
});

test("poll parses a named-field denial and reply refiles on the same thread", async () => {
  const a = adapter();
  const t = await a.submit(claim, ev);
  replyBody = "Status: DENIED\nReason: Missing field\nMissing field: wholesaler attestation\n";
  const d = await a.poll(t);
  expect(d).toMatchObject({ status: "DENIED", reason: "missing_field", field: "wholesaler_attestation" });
  const t2 = await a.reply(t, { evidence: ev, note: "Attestation attached" });
  expect(posts[1].in_reply_to).toBe("EML-0001");
  expect(t2.ticket_id).toBe("EML-0001");
  expect((await getDb().transcript.find({ claim_id: "C1" })).length).toBe(3);
});

test("unparseable reply throws", () => {
  expect(() => parseReply("C1", "T", "hello there")).toThrow();
});
