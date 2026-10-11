/**
 * JSON dev door: the same engine as the portal/inbox/fax doors, without the channel. Used by the
 * API's DirectAdapter until the real doors land, and kept as a fallback. Not shown in the demo.
 *   POST /dev/appeals                     {claim_id, pbm, state, delta, fields, attachments, statute}
 *   GET  /dev/appeals/:ticket             -> {status: PENDING|APPROVED|DENIED, reason, field, delta, message}
 *   POST /dev/appeals/:ticket/reply       same body as submit; restarts the response delay
 *   POST /dev/appeals/:ticket/release     lets a held response out now (PBM_SIM_HOLD=1) -> {released, ticket_id}
 *   POST /dev/appeals/release-all         releases every held response -> {released: n}
 */
import { persona } from "../personas";
import { appeals } from "../store";
import { createAppeal, decisionFor, refileAppeal, releaseAppeal, ticketView } from "./shared";

type AppealIn = { claim_id: string; pbm: string; state: string; delta: number; fields: Record<string, unknown>; attachments: string[] };

const unknown = () => Response.json({ error: "unknown ticket" }, { status: 404 });

export const devRoutes = {
  "/dev/appeals": {
    POST: async (req: Request) => {
      const b = (await req.json()) as AppealIn;
      const p = persona(b.pbm);
      const a = createAppeal({
        claim_id: b.claim_id, pbm: b.pbm, state: b.state, channel: p.channel,
        fields: b.fields, attachments: b.attachments, delta: b.delta,
      });
      return Response.json({ ...ticketView(a), channel: a.channel });
    },
  },
  "/dev/appeals/:ticket": {
    GET: (req: Bun.BunRequest<"/dev/appeals/:ticket">) => {
      const a = appeals.get(req.params.ticket);
      if (!a) return unknown();
      const decision = decisionFor(a);
      return decision ? Response.json(decision) : Response.json({ status: "PENDING" });
    },
  },
  "/dev/appeals/release-all": {
    POST: () => Response.json({ released: [...appeals.values()].filter(releaseAppeal).length }),
  },
  "/dev/appeals/:ticket/release": {
    POST: (req: Bun.BunRequest<"/dev/appeals/:ticket/release">) => {
      const a = appeals.get(req.params.ticket);
      if (!a) return unknown();
      return Response.json({ released: releaseAppeal(a), ticket_id: a.ticket_id });
    },
  },
  "/dev/appeals/:ticket/reply": {
    POST: async (req: Bun.BunRequest<"/dev/appeals/:ticket/reply">) => {
      const a = appeals.get(req.params.ticket);
      if (!a) return unknown();
      const b = (await req.json()) as AppealIn;
      refileAppeal(a, { state: b.state, fields: b.fields, attachments: b.attachments, delta: b.delta });
      return Response.json({ ...ticketView(a), channel: a.channel });
    },
  },
};
