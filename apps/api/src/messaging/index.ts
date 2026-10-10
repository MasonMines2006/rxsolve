/**
 * Outbound messages to people (pharmacist on iMessage, wholesaler on WhatsApp/SMS). Owner: P2.
 * Goes out through Spectrum when PHOTON_PROJECT_ID is set. Either way the message is recorded, so the
 * dashboard's pharmacist phone and channel viewer always show it (kill-switch: simulated phone).
 */
import type { ChannelMessage, MessageChannel } from "@rxsolve/contracts";
import { record } from "../transcript";
import { sendViaSpectrum, spectrumReady } from "./spectrum";

export async function send(
  channel: MessageChannel, to: string, text: string,
  opts: { counterparty: string; claimId?: string; audio?: { bytes: Uint8Array; url: string } | null },
): Promise<ChannelMessage> {
  const meta: Record<string, unknown> = { to };
  if (spectrumReady() && to) {
    try {
      await sendViaSpectrum(channel, to, text, opts.audio?.bytes);
      meta.delivered = true;
    } catch (e) {
      console.warn("spectrum send failed, dashboard only:", e);
      meta.delivered = false;
    }
  }
  return record({
    claim_id: opts.claimId ?? null, channel, direction: "out", counterparty: opts.counterparty,
    text, audio_url: opts.audio?.url ?? null, meta,
  });
}
