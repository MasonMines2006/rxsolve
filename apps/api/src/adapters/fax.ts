/**
 * FaxAdapter (AGT-05). Owner: P2.
 * Renders cover sheet + evidence PDF, POSTs it to the PBM Sim fax line, reads the scanned-look reply PDF
 * (model vision with a text-layer fallback, see fax-read.ts). Every submit/poll/reply is recorded.
 *   POST /fax/:pbm                  body: PDF; header x-ticket-id on a reply; -> {ticket_id, submitted_at, expected_response_by}
 *   GET  /fax/:pbm/return/:ticket   202 or 204 while pending; 200 application/pdf when the decision is ready
 */
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { Claim, Decision, Evidence, Reply, Ticket } from "@rxsolve/contracts";
import { EVIDENCE_DIR } from "../agents/packet";
import { config } from "../config";
import { record } from "../transcript";
import { coverLines, pdfText, renderFax, type CoverClaim } from "./fax-pdf";
import { readFaxReply } from "./fax-read";
import type { ChannelAdapter } from "./index";

type SimTicket = { ticket_id: string; submitted_at?: string; expected_response_by?: string };

export class FaxAdapter implements ChannelAdapter {
  channel = "fax" as const;
  constructor(private outDir = EVIDENCE_DIR) {}

  private async evidenceLines(ev: Evidence): Promise<string[]> {
    const lines = ["EVIDENCE", `Statute: ${ev.statute}`, `Entitlement: ${ev.entitlement}`, `Underpayment: $${ev.delta.toFixed(2)}`, ""];
    for (const name of ev.attachments) {
      lines.push(`ATTACHMENT ${name}`);
      const f = Bun.file(join(this.outDir, name));
      if (await f.exists()) lines.push(...pdfText(new Uint8Array(await f.arrayBuffer())));
      lines.push("");
    }
    return lines;
  }

  private async send(claim: CoverClaim, ev: Evidence, ticketId?: string, note?: string) {
    const pdf = renderFax(coverLines(claim, ev, ticketId, note), await this.evidenceLines(ev), `Fax ${claim.claim_id}`);
    await mkdir(this.outDir, { recursive: true });
    const name = `fax_${claim.claim_id}${ticketId ? `_${ticketId}` : ""}.pdf`;
    await Bun.write(join(this.outDir, name), pdf);
    const r = await fetch(`${config.pbmSimUrl}/fax/${claim.pbm}`, {
      method: "POST",
      headers: { "content-type": "application/pdf", "x-claim-id": claim.claim_id, ...(ticketId ? { "x-ticket-id": ticketId } : {}) },
      body: pdf,
    });
    if (!r.ok) throw new Error(`PBM Sim fax line: ${r.status}`);
    const s = (await r.json()) as SimTicket;
    const now = new Date().toISOString();
    const ticket: Ticket = {
      claim_id: claim.claim_id, pbm: claim.pbm, channel: "fax", ticket_id: s.ticket_id,
      submitted_at: s.submitted_at ?? now, expected_response_by: s.expected_response_by ?? now,
    };
    return { ticket, name };
  }

  async submit(claim: Claim, ev: Evidence): Promise<Ticket> {
    const { ticket, name } = await this.send(claim, ev);
    await record({
      claim_id: claim.claim_id, channel: "fax", direction: "out", counterparty: claim.pbm,
      text: `Fax sent: cover sheet + ${ev.attachments.length} attachment(s), ${ev.statute}, $${ev.delta.toFixed(2)}`,
      attachments: [name], meta: { ticket_id: ticket.ticket_id, fields: ev.fields },
    });
    return ticket;
  }

  async poll(ticket: Ticket): Promise<Decision | null> {
    const r = await fetch(`${config.pbmSimUrl}/fax/${ticket.pbm}/return/${ticket.ticket_id}`);
    if (r.status === 202 || r.status === 204) return null;
    if (!r.ok) throw new Error(`PBM Sim fax return ${ticket.ticket_id}: ${r.status}`);
    const pdf = new Uint8Array(await r.arrayBuffer());
    const name = `fax_reply_${ticket.ticket_id}.pdf`;
    await mkdir(this.outDir, { recursive: true });
    await Bun.write(join(this.outDir, name), pdf);
    const read = await readFaxReply(pdf);
    await record({
      claim_id: ticket.claim_id, channel: "fax", direction: "in", counterparty: ticket.pbm,
      text: read.raw ?? read.status, attachments: [name], meta: { ticket_id: ticket.ticket_id, status: read.status },
    });
    return { claim_id: ticket.claim_id, ticket_id: ticket.ticket_id, ...read };
  }

  async reply(ticket: Ticket, msg: Reply): Promise<Ticket> {
    const f = msg.evidence.fields;
    const claim: CoverClaim = {
      claim_id: ticket.claim_id, pbm: ticket.pbm, pharmacy_id: config.pharmacyId,
      plan: String(f.plan ?? ""), state: String(f.state ?? ""),
    };
    const { ticket: next, name } = await this.send(claim, msg.evidence, ticket.ticket_id, msg.note);
    await record({
      claim_id: ticket.claim_id, channel: "fax", direction: "out", counterparty: ticket.pbm,
      text: msg.note ?? "Fax refiled with the requested document", attachments: [name],
      meta: { ticket_id: next.ticket_id, fields: msg.evidence.fields },
    });
    return next;
  }
}
