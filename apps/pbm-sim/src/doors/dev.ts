/**
 * JSON dev door: the same engine as the portal/inbox/fax doors, without the channel. Used by the
 * API's DirectAdapter until the real doors land, and kept as a fallback. Not shown in the demo.
 *   POST /dev/appeals                     {claim_id, pbm, state, delta, fields, attachments, statute}
 *   GET  /dev/appeals/:ticket             -> {status: PENDING|APPROVED|DENIED, reason, field, delta, message}
 *   POST /dev/appeals/:ticket/reply       same body as submit; restarts the response delay
 */
import { decide } from "../engine";
import { delayMs, persona } from "../personas";
import { appeals, nextTicket, type Appeal } from "../store";

type AppealIn = { claim_id: string; pbm: string; state: string; delta: number; fields: Record<string, unknown>; attachments: string[] };

const ticketView = (a: Appeal) => ({
  ticket_id: a.ticket_id, channel: a.channel, submitted_at: a.submitted_at,
  expected_response_by: new Date(a.decide_at).toISOString(),
});
const unknown = () => Response.json({ error: "unknown ticket" }, { status: 404 });

export const devRoutes = {
  "/dev/appeals": {
    POST: async (req: Request) => {
      const b = (await req.json()) as AppealIn;
      const p = persona(b.pbm);
      const a: Appeal = {
        ticket_id: nextTicket(p.ticket_prefix), claim_id: b.claim_id, pbm: b.pbm, state: b.state, channel: p.channel,
        fields: b.fields, attachments: b.attachments, delta: b.delta, submitted_at: new Date().toISOString(),
        decide_at: Date.now() + delayMs(b.pbm), round: 1, decision: null, history: [],
      };
      appeals.set(a.ticket_id, a);
      return Response.json(ticketView(a));
    },
  },
  "/dev/appeals/:ticket": {
    GET: (req: Bun.BunRequest<"/dev/appeals/:ticket">) => {
      const a = appeals.get(req.params.ticket);
      if (!a) return unknown();
      if (Date.now() < a.decide_at) return Response.json({ status: "PENDING" });
      a.decision ??= decide(a.pbm, a.state, a.fields, a.delta, a.round);
      return Response.json(a.decision);
    },
  },
  "/dev/appeals/:ticket/reply": {
    POST: async (req: Bun.BunRequest<"/dev/appeals/:ticket/reply">) => {
      const a = appeals.get(req.params.ticket);
      if (!a) return unknown();
      const b = (await req.json()) as AppealIn;
      a.history.push({ round: a.round, decision: a.decision });
      Object.assign(a, { fields: b.fields, attachments: b.attachments, decision: null, round: a.round + 1, decide_at: Date.now() + delayMs(a.pbm) });
      return Response.json(ticketView(a));
    },
  },
};
