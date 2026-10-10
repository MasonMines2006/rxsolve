/** Pharmacist + wholesaler messaging endpoints. Owner: P2. */
import type { MessageChannel } from "@rxsolve/contracts";
import { handleReply, sendDigest } from "../agents/notifier";
import { config } from "../config";
import { send } from "../messaging";
import { record } from "../transcript";

/** Every inbound message (Spectrum or the dashboard phone mock) lands here. */
export async function handleInbound(m: { channel: MessageChannel; sender: string; text: string }) {
  const who = m.channel === "imessage" ? "pharmacist" : "wholesaler";
  await record({ channel: m.channel, direction: "in", counterparty: who, text: m.text, meta: { from: m.sender } });
  if (who === "pharmacist") await send("imessage", m.sender, await handleReply(m.text), { counterparty: "pharmacist" });
}

export const messagingRoutes = {
  /** Demo: the end-of-day digest, triggered by hand. */
  "/api/digest": { POST: async () => Response.json(await sendDigest(config.pharmacyId)) },

  /** Lets the dashboard's phone mock reply when iMessage is not connected. Body: {text}. */
  "/api/dev/pharmacist-reply": {
    POST: async (req: Request) => {
      const { text } = (await req.json()) as { text: string };
      await handleInbound({ channel: "imessage", sender: config.pharmacistPhone || "dashboard", text });
      return Response.json({ ok: true });
    },
  },
};
