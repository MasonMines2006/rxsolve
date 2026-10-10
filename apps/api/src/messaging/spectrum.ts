/**
 * Photon Spectrum (spectrum-ts), in-process. Owner: P2.
 * Setup follows Photon's "send your first message" scaffold (PROJECT_ID/PROJECT_SECRET, iMessage cloud
 * provider). Free/Pro shared lines only reach phones registered as project users in the Photon
 * dashboard. Agent reference for the SDK: .claude/skills/spectrum/.
 */
import { Spectrum, voice } from "spectrum-ts";
import { imessage } from "spectrum-ts/providers/imessage";
import { whatsappBusiness } from "spectrum-ts/providers/whatsapp-business";
import type { MessageChannel } from "@rxsolve/contracts";
import { config } from "../config";
import { sameContact } from "./inbox";

type Inbound = (m: { channel: MessageChannel; sender: string; text: string }) => Promise<void>;

let app: Awaited<ReturnType<typeof Spectrum>> | null = null;

export const spectrumReady = () => app !== null;

const normalize = (id: string) => (id.includes("@") ? id.trim().toLowerCase() : id.replace(/\D/g, ""));

/** With PHARMACIST_PHONE set, only that handle may command the notifier; unset allows any sender. */
export function senderAllowed(sender: string, pharmacist: string): boolean {
  if (!pharmacist) return true;
  const a = normalize(sender);
  const b = normalize(pharmacist);
  return a !== "" && (a === b || a.endsWith(b) || b.endsWith(a));
}

/** WhatsApp Business (wholesaler channel); null without all three Meta credentials. */
function whatsappConfig() {
  const { WHATSAPP_ACCESS_TOKEN: accessToken, WHATSAPP_PHONE_NUMBER_ID: phoneNumberId, WHATSAPP_APP_SECRET: appSecret } = process.env;
  return accessToken && phoneNumberId && appSecret ? { accessToken, phoneNumberId, appSecret } : null;
}

export async function startSpectrum(onInbound: Inbound): Promise<boolean> {
  if (!config.photonProjectId || !config.photonProjectSecret) return false;
  const whatsappEnv = whatsappConfig();
  app = await Spectrum({
    projectId: config.photonProjectId,
    projectSecret: config.photonProjectSecret,
    // The SDK types providers as a fixed tuple; WhatsApp is appended only when its credentials exist.
    providers: (whatsappEnv ? [imessage.config(), whatsappBusiness.config(whatsappEnv)] : [imessage.config()]) as [ReturnType<typeof imessage.config>],
  });
  void (async () => {
    for await (const [, message] of app!.messages) {
      if (message.direction !== "inbound" || message.content.type !== "text") continue;
      const sender = message.sender?.id ?? "";
      const whatsapp = String(message.platform).includes("whatsapp");
      // An iMessage-line sender matching the wholesaler contact is the SMS fallback reply.
      const sms = !whatsapp && config.wholesalerContact !== "" && sameContact(sender, config.wholesalerContact);
      if (!whatsapp && !sms && !senderAllowed(sender, config.pharmacistPhone)) {
        console.warn(`spectrum: ignored inbound message from unexpected sender ${sender}`);
        continue;
      }
      await onInbound({ channel: whatsapp ? "whatsapp" : sms ? "sms" : "imessage", sender, text: message.content.text });
    }
  })();
  return true;
}

export async function sendViaSpectrum(channel: MessageChannel, to: string, text: string, audio?: Uint8Array) {
  if (!app) throw new Error("spectrum not started");
  if (channel === "whatsapp") {
    if (!whatsappConfig()) throw new Error("whatsapp provider not configured");
    const wa = whatsappBusiness(app);
    await (await wa.space.create(await wa.user(to.replace(/\D/g, "")))).send(text);
    return;
  }
  if (channel !== "imessage" && channel !== "sms") throw new Error(`${channel} provider not configured`);
  const im = imessage(app);
  const space = await im.space.create(await im.user(to));
  await space.send(text);
  if (audio) await space.send(voice(Buffer.from(audio), { name: "recap.mp3", mimeType: "audio/mpeg" }));
}
