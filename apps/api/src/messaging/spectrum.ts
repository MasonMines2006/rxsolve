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

const normalize = (id: string) => {
  const value = id.trim();
  if (value.includes("@")) return value.toLowerCase();
  const digits = value.replace(/\D/g, "");
  return digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
};

/** With PHARMACIST_PHONE set, only that handle may command the notifier; unset allows any sender. */
export function senderAllowed(sender: string, pharmacist: string): boolean {
  if (!pharmacist) return true;
  const normalizedSender = normalize(sender);
  const normalizedPharmacist = normalize(pharmacist);
  if (!normalizedSender || normalizedSender !== normalizedPharmacist) return false;
  return normalizedSender.includes("@") || normalizedSender.length >= 7;
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

/** iMessage targets go out as E.164: a bare US number gets +1; email handles and other formats pass through. */
export function toTarget(to: string): string {
  const t = to.trim();
  if (t.includes("@")) return t;
  const digits = t.replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return t;
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
  const space = await im.space.create(await im.user(toTarget(to)));
  await space.send(text);
  if (audio) await space.send(voice(Buffer.from(audio), { name: "recap.mp3", mimeType: "audio/mpeg" }));
}

/** Voice note only; the text it recaps was already sent on its own. */
export async function sendVoiceViaSpectrum(to: string, audio: Uint8Array) {
  if (!app) throw new Error("spectrum not started");
  const im = imessage(app);
  const space = await im.space.create(await im.user(toTarget(to)));
  await space.send(voice(Buffer.from(audio), { name: "recap.mp3", mimeType: "audio/mpeg" }));
}
