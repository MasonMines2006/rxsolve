/**
 * PortalAdapter (AGT-03). Owner: P2.
 * Fills the PBM Sim portal form from a fixed field map, uploads the evidence PDFs and reads the
 * status page. Two drivers: a Playwright browser agent (PORTAL_MODE=browser) and a scripted HTTP
 * fallback (default; the BUILD_PLAN kill-switch). Door contract: docs/DECISIONS.md, "AGT-03".
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { Claim, Decision, Evidence, Reply, Ticket } from "@rxsolve/contracts";
import { config } from "../config";
import { record } from "../transcript";
import { EVIDENCE_DIR } from "../agents/packet";
import { spec } from "../reference";
import type { ChannelAdapter } from "./index";

export type PortalMode = "browser" | "scripted";
export type PortalOpts = { mode?: PortalMode; baseUrl?: string; evidenceDir?: string; fetch?: typeof fetch };

/** The status block of one portal page, plus the ticket it belongs to. */
export type PortalStatus = {
  ticket_id: string;
  status: "PENDING" | "APPROVED" | "DENIED";
  submitted_at: string | null;
  expected_response_by: string | null;
  reason: Decision["reason"];
  field: string | null;
  delta: number | null;
  message: string | null;
};

const SCALAR = (v: unknown): v is string | number | boolean => ["string", "number", "boolean"].includes(typeof v);

/** Fixed field map: the spec's required_fields, then any other scalar fields the evidence carries. */
export function fieldMap(pbm: string, ev: Evidence): Record<string, string> {
  const out: Record<string, string> = {};
  const names = [...new Set([...(spec(pbm)?.required_fields ?? []), ...Object.keys(ev.fields)])];
  for (const k of names) {
    const v = ev.fields[k];
    if (SCALAR(v)) out[k] = String(v);
  }
  out.claim_id = ev.claim_id;
  out.state = String(ev.fields.state ?? "");
  out.delta = ev.delta.toFixed(2);
  out.statute = ev.statute;
  return out;
}

const unescape = (s: string) =>
  s.replaceAll("&quot;", '"').replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&#39;", "'").replaceAll("&amp;", "&");
const attr = (html: string, name: string): string | null => {
  const m = html.match(new RegExp(`data-${name}="([^"]*)"`));
  return m ? unescape(m[1]!) : null;
};

/** Parses the status block (`#status` with data-* attributes, message in `#message`). */
export function parseStatus(html: string, ticketId: string): PortalStatus {
  const status = attr(html, "status");
  if (status !== "PENDING" && status !== "APPROVED" && status !== "DENIED") throw new Error("portal status page has no #status block");
  const delta = attr(html, "delta");
  const message = html.match(/id="message"[^>]*>([\s\S]*?)<\/[a-z]+>/)?.[1]?.replace(/<[^>]+>/g, "").trim();
  return {
    ticket_id: attr(html, "ticket") ?? ticketId,
    status,
    submitted_at: attr(html, "submitted-at"),
    expected_response_by: attr(html, "expected-by"),
    reason: (attr(html, "reason") || null) as Decision["reason"],
    field: attr(html, "field") || null,
    delta: delta ? Number(delta) : null,
    message: message ? unescape(message) : null,
  };
}

export class PortalAdapter implements ChannelAdapter {
  channel = "portal" as const;
  private o: Required<Omit<PortalOpts, "fetch">> & { fetch: typeof fetch };

  constructor(opts: PortalOpts = {}) {
    this.o = {
      mode: opts.mode ?? (process.env.PORTAL_MODE === "browser" ? "browser" : "scripted"),
      baseUrl: (opts.baseUrl ?? config.pbmSimUrl).replace(/\/$/, ""),
      evidenceDir: opts.evidenceDir ?? EVIDENCE_DIR,
      fetch: opts.fetch ?? fetch,
    };
  }

  private url(pbm: string, rest: string) {
    return `${this.o.baseUrl}/portal/${pbm}${rest}`;
  }

  private files(names: string[]) {
    return names.map((n) => ({ name: n, path: join(this.o.evidenceDir, n) }));
  }

  // ---- scripted driver (HTTP, no browser)

  private async scriptedFile(pbm: string, path: string, fields: Record<string, string>, names: string[]) {
    const form = new FormData();
    for (const [k, v] of Object.entries(fields)) form.set(k, v);
    for (const f of this.files(names)) {
      // Documents added during negotiation may not be rendered on disk; upload a stub rather than skip.
      const blob = existsSync(f.path) ? Bun.file(f.path) : new Blob([`(not rendered) ${f.name}`], { type: "application/pdf" });
      form.append("attachment", blob, f.name);
    }
    const r = await this.o.fetch(this.url(pbm, path), { method: "POST", body: form, redirect: "manual" });
    const loc = r.headers.get("location");
    if (loc && r.status >= 300 && r.status < 400) {
      const full = new URL(loc, this.o.baseUrl).toString();
      return this.scriptedStatus(pbm, full.split("/").pop()!, full);
    }
    if (!r.ok) throw new Error(`portal POST ${path}: ${r.status}`);
    const html = await r.text();
    return parseStatus(html, attr(html, "ticket") ?? "");
  }

  private async scriptedStatus(pbm: string, ticket: string, full?: string): Promise<PortalStatus> {
    const r = await this.o.fetch(full ?? this.url(pbm, `/status/${ticket}`));
    if (!r.ok) throw new Error(`portal status ${ticket}: ${r.status}`);
    return parseStatus(await r.text(), ticket);
  }

  // ---- browser driver (Playwright, imported lazily so tests and the scripted path need no browser)

  private async withPage<T>(fn: (page: any) => Promise<T>): Promise<T> {
    const mod = "playwright";
    const { chromium } = (await import(mod)) as any;
    const browser = await chromium.launch({ headless: process.env.PORTAL_HEADED !== "1" });
    try {
      return await fn(await browser.newPage());
    } finally {
      await browser.close();
    }
  }

  private async pageStatus(page: any, ticketFromUrl: string): Promise<PortalStatus> {
    await page.waitForSelector("#status");
    return parseStatus(await page.content(), ticketFromUrl);
  }

  private async browserFile(pbm: string, path: string, fields: Record<string, string>, names: string[]) {
    return this.withPage(async (page) => {
      await page.goto(this.url(pbm, path));
      for (const [k, v] of Object.entries(fields)) {
        const el = page.locator(`[name="${k}"]`);
        if ((await el.count()) > 0) await el.first().fill(v);
      }
      const real = this.files(names).filter((f) => existsSync(f.path)).map((f) => f.path);
      if (real.length) await page.setInputFiles('input[type="file"]', real);
      await Promise.all([page.waitForURL(/\/status\//), page.click('[type="submit"]')]);
      return this.pageStatus(page, new URL(page.url()).pathname.split("/").pop()!);
    });
  }

  private async browserStatus(pbm: string, ticket: string) {
    return this.withPage(async (page) => {
      await page.goto(this.url(pbm, `/status/${ticket}`));
      return this.pageStatus(page, ticket);
    });
  }

  private file(pbm: string, path: string, fields: Record<string, string>, names: string[]) {
    return this.o.mode === "browser" ? this.browserFile(pbm, path, fields, names) : this.scriptedFile(pbm, path, fields, names);
  }

  private status(pbm: string, ticket: string) {
    return this.o.mode === "browser" ? this.browserStatus(pbm, ticket) : this.scriptedStatus(pbm, ticket);
  }

  private toTicket(t: Pick<Ticket, "claim_id" | "pbm">, s: PortalStatus): Ticket {
    const now = new Date().toISOString();
    return {
      claim_id: t.claim_id, pbm: t.pbm, channel: "portal", ticket_id: s.ticket_id,
      submitted_at: s.submitted_at ?? now, expected_response_by: s.expected_response_by ?? now,
    };
  }

  async submit(claim: Claim, ev: Evidence): Promise<Ticket> {
    const fields = fieldMap(claim.pbm, ev);
    const ticket = this.toTicket(claim, await this.file(claim.pbm, "/appeal", fields, ev.attachments));
    await record({
      claim_id: claim.claim_id, channel: "portal", direction: "out", counterparty: claim.pbm,
      text: `Portal form filed (${this.o.mode}): ${Object.keys(fields).length} fields, ${ev.attachments.length} attachments, $${ev.delta.toFixed(2)}`,
      attachments: ev.attachments, meta: { ticket_id: ticket.ticket_id, mode: this.o.mode, form: fields },
    });
    return ticket;
  }

  async poll(ticket: Ticket): Promise<Decision | null> {
    const s = await this.status(ticket.pbm, ticket.ticket_id);
    if (s.status === "PENDING") return null;
    await record({
      claim_id: ticket.claim_id, channel: "portal", direction: "in", counterparty: ticket.pbm,
      text: s.message ?? s.status, meta: { ticket_id: ticket.ticket_id, mode: this.o.mode, status: s.status },
    });
    return {
      claim_id: ticket.claim_id, ticket_id: ticket.ticket_id, status: s.status,
      reason: s.reason, field: s.field, delta: s.delta, raw: s.message,
    };
  }

  async reply(ticket: Ticket, msg: Reply): Promise<Ticket> {
    const fields = fieldMap(ticket.pbm, msg.evidence);
    if (msg.note) fields.note = msg.note;
    const next = this.toTicket(ticket, await this.file(ticket.pbm, `/status/${ticket.ticket_id}/reply`, fields, msg.evidence.attachments));
    await record({
      claim_id: ticket.claim_id, channel: "portal", direction: "out", counterparty: ticket.pbm,
      text: msg.note ?? "Message center reply with the requested document", attachments: msg.evidence.attachments,
      meta: { ticket_id: next.ticket_id, mode: this.o.mode, form: fields },
    });
    return next;
  }
}
