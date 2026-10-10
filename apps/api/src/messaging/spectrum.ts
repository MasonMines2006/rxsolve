/**
 * Photon Spectrum (spectrum-ts), in-process. Owner: P2.
 * Setup follows Photon's "send your first message" scaffold (PROJECT_ID/PROJECT_SECRET, iMessage cloud
 * provider). Free/Pro shared lines only reach phones registered as project users in the Photon
 * dashboard. Agent reference for the SDK: .claude/skills/spectrum/.
 */
import { Spectrum, voice } from "spectrum-ts";
import { imessage } from "spectrum-ts/providers/imessage";
import type { MessageChannel } from "@rxsolve/contracts";
import { config } from "../config";

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

export async function startSpectrum(onInbound: Inbound): Promise<boolean> {
  if (!config.photonProjectId || !config.photonProjectSecret) return false;
  app = await Spectrum({
    projectId: config.photonProjectId,
    projectSecret: config.photonProjectSecret,
    providers: [imessage.config()], // TODO(AGT-06): add WhatsApp Business for the wholesaler
  });
  void (async () => {
    for await (const [, message] of app!.messages) {
      if (message.direction !== "inbound" || message.content.type !== "text") continue;
      const sender = message.sender?.id ?? "";
      if (!senderAllowed(sender, config.pharmacistPhone)) {
        console.warn(`spectrum: ignored inbound message from unexpected sender ${sender}`);
        continue;
      }
      await onInbound({ channel: "imessage", sender, text: message.content.text });
    }
  })();
  return true;
}

export async function sendViaSpectrum(channel: MessageChannel, to: string, text: string, audio?: Uint8Array) {
  if (!app) throw new Error("spectrum not started");
  if (channel !== "imessage") throw new Error(`TODO(AGT-06): ${channel} provider not configured`);
  const im = imessage(app);
  const space = await im.space.create(await im.user(to));
  await space.send(text);
  if (audio) await space.send(voice(Buffer.from(audio), { name: "recap.mp3", mimeType: "audio/mpeg" }));
}
