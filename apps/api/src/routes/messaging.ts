/** Pharmacist + wholesaler messaging endpoints. Owner: P2. */
import type { MessageChannel } from "@rxsolve/contracts";
import { serveArtifact } from "../artifacts";
import { handleReply, sendDigest } from "../agents/notifier";
import { config } from "../config";
import { send } from "../messaging";
import { deliverInbound } from "../messaging/inbox";
import { record } from "../transcript";

/** Every inbound message (Spectrum or the dashboard phone mock) lands here. */
export async function handleInbound(m: { channel: MessageChannel; sender: string; text: string }) {
  const who = m.channel === "imessage" ? "pharmacist" : "wholesaler";
  await record({ channel: m.channel, direction: "in", counterparty: who, text: m.text, meta: { from: m.sender } });
  if (who === "wholesaler") deliverInbound(m.sender, m.text);
  if (who === "pharmacist") await send("imessage", m.sender, await handleReply(m.text), { counterparty: "pharmacist" });
}

export const messagingRoutes = {
  /** Step artifacts (evidence PDFs, fax pages, portal and email snapshots) from the evidence dir. */
  "/api/artifacts/:name": { GET: (req: Request & { params: { name: string } }) => serveArtifact(req.params.name) },

  /** Demo: the end-of-day digest, triggered by hand. */
  "/api/digest": { POST: async () => Response.json(await sendDigest(config.pharmacyId)) },

  /** Demo: types the wholesaler's reply when WHOLESALER_STUB=manual or WhatsApp is not connected. Body: {text, channel?}. */
  "/api/dev/wholesaler-reply": {
    POST: async (req: Request) => {
      const { text, channel } = (await req.json()) as { text: string; channel?: MessageChannel };
      await handleInbound({ channel: channel ?? "whatsapp", sender: config.wholesalerContact, text });
      return Response.json({ ok: true });
    },
  },

  /** Lets the dashboard's phone mock reply when iMessage is not connected. Body: {text}. */
  "/api/dev/pharmacist-reply": {
    POST: async (req: Request) => {
      const { text } = (await req.json()) as { text: string };
      await handleInbound({ channel: "imessage", sender: config.pharmacistPhone || "dashboard", text });
      return Response.json({ ok: true });
    },
  },
};
