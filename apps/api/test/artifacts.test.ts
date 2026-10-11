/** Step artifacts: the /api/artifacts route guards and the portal and email snapshots. */
import { afterAll, beforeAll, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Claim, Evidence, Ticket } from "@rxsolve/contracts";
import { PortalAdapter } from "../src/adapters/portal";
import { safeId, serveArtifact } from "../src/artifacts";
import { config } from "../src/config";
import { getDb } from "../src/db";

config.databaseUrl = "";

const dir = mkdtempSync(join(tmpdir(), "rxs-art-"));
writeFileSync(join(dir, "appeal_C-9.pdf"), "%PDF-1.4 art");
writeFileSync(join(dir, "snap.html"), "<html><script>alert(1)</script></html>");

test("route serves a pdf and a sandboxed html snapshot with safe headers", async () => {
  const pdf = await serveArtifact("appeal_C-9.pdf", dir);
  expect(pdf.status).toBe(200);
  expect(pdf.headers.get("content-type")).toBe("application/pdf");
  expect(pdf.headers.get("x-content-type-options")).toBe("nosniff");
  expect(pdf.headers.get("content-disposition")).toContain("inline");
  expect(await pdf.text()).toBe("%PDF-1.4 art");
  const html = await serveArtifact("snap.html", dir);
  expect(html.headers.get("content-type")).toContain("text/html");
  expect(html.headers.get("content-security-policy")).toBe("sandbox");
});

test("route rejects traversal, subpaths, dotfiles, and unknown names", async () => {
  for (const n of ["../x", "a/b", ".env", "%2e%2e%2fx", "..%2Fx", "a..b/c", ""]) {
    expect((await serveArtifact(n, dir)).status).toBe(400);
  }
  expect((await serveArtifact("nope.pdf", dir)).status).toBe(404);
});

test("route is mounted over HTTP, GET only", async () => {
  const { messagingRoutes } = await import("../src/routes/messaging");
  const server = Bun.serve({ port: 0, routes: { ...messagingRoutes }, fetch: () => new Response("x", { status: 404 }) });
  try {
    const base = `http://localhost:${server.port}`;
    expect((await fetch(`${base}/api/artifacts/..%2F..%2Fetc%2Fpasswd`)).status).toBe(400);
    expect((await fetch(`${base}/api/artifacts/definitely_missing.pdf`)).status).toBe(404);
    expect((await fetch(`${base}/api/artifacts/definitely_missing.pdf`, { method: "POST" })).status).toBeGreaterThanOrEqual(400);
  } finally {
    server.stop(true);
  }
});

test("safeId keeps names inside the artifact charset", () => {
  expect(safeId("../a b/c")).toBe("a_b_c");
});

// ---- portal scripted flow against a fake door

const PAGE = (t: string) =>
  `<html><head><link rel="stylesheet" href="/x.css"><script src="/x.js"></script></head><body><div id="status" data-ticket="${t}" data-status="APPROVED" data-delta="6.40"></div><p id="message">Approved</p></body></html>`;
let server: ReturnType<typeof Bun.serve>;
let base = "";
beforeAll(() => {
  server = Bun.serve({
    port: 0,
    async fetch(req) {
      const u = new URL(req.url);
      if (req.method === "POST") {
        await req.formData();
        return new Response(null, { status: 303, headers: { location: "/portal/PBM_PORTAL/status/PRT-7" } });
      }
      return new Response(PAGE("PRT-7"));
    },
  });
  base = `http://localhost:${server.port}`;
});
afterAll(() => server.stop(true));

const claim = { claim_id: "C-9", pbm: "PBM_PORTAL" } as unknown as Claim;
const ev: Evidence = {
  claim_id: "C-9", statute: "s", entitlement: "e", attachments: ["appeal_C-9.pdf"], required_fields_present: [],
  spec_version: "v", completeness: 1, fields: { ndc: "1<2", state: "TN" }, delta: 6.4, appeal_deadline: null,
};

test("portal scripted filing and decision write form and status snapshots into attachments", async () => {
  const a = new PortalAdapter({ mode: "scripted", baseUrl: base, evidenceDir: dir });
  const t = await a.submit(claim, ev);
  expect(t.ticket_id).toBe("PRT-7");
  const form = readFileSync(join(dir, "portal_form_C-9_PRT-7.html"), "utf8");
  expect(form).toContain("PBM_PORTAL");
  expect(form).toContain("1&lt;2");
  expect(form).toContain("appeal_C-9.pdf");
  const d = await a.poll(t as Ticket);
  expect(d?.status).toBe("APPROVED");
  const status = readFileSync(join(dir, "portal_status_C-9_PRT-7.html"), "utf8");
  expect(status).toContain('id="status"');
  expect(status).not.toContain("<script");
  expect(status).not.toContain("<link");
  const rows = await getDb().transcript.find({ claim_id: "C-9" });
  const out = rows.find((r) => r.direction === "out")!;
  const inn = rows.find((r) => r.direction === "in")!;
  expect(out.attachments).toEqual(["appeal_C-9.pdf", "portal_form_C-9_PRT-7.html"]);
  expect(inn.attachments).toEqual(["portal_status_C-9_PRT-7.html"]);
});

test("a snapshot write failure never fails the filing", async () => {
  const blocker = join(dir, "blocker");
  writeFileSync(blocker, "file, not a dir");
  const a = new PortalAdapter({ mode: "scripted", baseUrl: base, evidenceDir: join(blocker, "sub") });
  const t = await a.submit({ ...claim, claim_id: "C-10" } as Claim, { ...ev, claim_id: "C-10", attachments: [] });
  expect(t.ticket_id).toBe("PRT-7");
  expect(existsSync(join(blocker, "sub"))).toBe(false);
  const rows = await getDb().transcript.find({ claim_id: "C-10" });
  expect(rows[0]!.attachments).toEqual([]);
});
