/**
 * DirectAdapter: files through the PBM Sim's JSON dev door (/dev/appeals).
 * Not a demo channel. It lets the full loop (file, deny, remediate, refile, settle) run before the
 * portal/email/fax adapters land, and is the last-resort fallback if one of them flakes.
 */
import type { Channel, Claim, Decision, Evidence, Reply, Ticket } from "@rxsolve/contracts";
import { config } from "../config";
import { record } from "../transcript";
import type { ChannelAdapter } from "./index";

type SimTicket = { ticket_id: string; submitted_at: string; expected_response_by: string };

async function sim<T>(path: string, body?: unknown): Promise<T> {
  const r = await fetch(`${config.pbmSimUrl}${path}`, body === undefined ? undefined : {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`PBM Sim ${path}: ${r.status}`);
  return (await r.json()) as T;
}

export class DirectAdapter implements ChannelAdapter {
  constructor(public channel: Channel) {}

  private body(claimId: string, pbm: string, ev: Evidence) {
    return { claim_id: claimId, pbm, state: ev.fields.state, delta: ev.delta, fields: ev.fields, attachments: ev.attachments, statute: ev.statute };
  }

  private ticket(t: Pick<Ticket, "claim_id" | "pbm">, s: SimTicket): Ticket {
    return { claim_id: t.claim_id, pbm: t.pbm, channel: this.channel, ...s };
  }

  async submit(claim: Claim, ev: Evidence): Promise<Ticket> {
    const ticket = this.ticket(claim, await sim<SimTicket>("/dev/appeals", this.body(claim.claim_id, claim.pbm, ev)));
    await record({
      claim_id: claim.claim_id, channel: this.channel, direction: "out", counterparty: claim.pbm,
      text: `Appeal filed: ${ev.statute}, $${ev.delta.toFixed(2)}`, attachments: ev.attachments,
      meta: { ticket_id: ticket.ticket_id, fields: ev.fields },
    });
    return ticket;
  }

  async poll(ticket: Ticket): Promise<Decision | null> {
    const d = await sim<{ status: string; reason?: Decision["reason"]; field?: string; delta?: number; message?: string }>(
      `/dev/appeals/${ticket.ticket_id}`,
    );
    if (d.status === "PENDING") return null;
    await record({
      claim_id: ticket.claim_id, channel: this.channel, direction: "in", counterparty: ticket.pbm,
      text: d.message ?? d.status, meta: { ticket_id: ticket.ticket_id },
    });
    return {
      claim_id: ticket.claim_id, ticket_id: ticket.ticket_id, status: d.status as Decision["status"],
      reason: d.reason ?? null, field: d.field ?? null, delta: d.delta ?? null, raw: d.message ?? null,
    };
  }

  async reply(ticket: Ticket, msg: Reply): Promise<Ticket> {
    const next = this.ticket(ticket, await sim<SimTicket>(`/dev/appeals/${ticket.ticket_id}/reply`, this.body(ticket.claim_id, ticket.pbm, msg.evidence)));
    await record({
      claim_id: ticket.claim_id, channel: this.channel, direction: "out", counterparty: ticket.pbm,
      text: msg.note ?? "Refiled with the requested document", attachments: msg.evidence.attachments,
      meta: { ticket_id: next.ticket_id, fields: msg.evidence.fields },
    });
    return next;
  }
}
