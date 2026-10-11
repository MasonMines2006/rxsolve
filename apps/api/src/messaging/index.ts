/**
 * Outbound messages to people (pharmacist on iMessage, wholesaler on WhatsApp/SMS). Owner: P2.
 * Goes out through Spectrum when PHOTON_PROJECT_ID is set. Either way the message is recorded, so the
 * dashboard's pharmacist phone and channel viewer always show it (kill-switch: simulated phone).
 */
import type { ChannelMessage, MessageChannel } from "@rxsolve/contracts";
import { record } from "../transcript";
import { sendViaSpectrum, sendVoiceViaSpectrum, spectrumReady } from "./spectrum";

/** A voice note recorded as its own channel.message with `audio_url`; the text it recaps went out first. */
export async function sendVoice(
  to: string, audio: { bytes: Uint8Array; url: string },
  opts: { counterparty: string; text: string; meta?: Record<string, unknown> },
): Promise<ChannelMessage> {
  const meta: Record<string, unknown> = { to, ...opts.meta };
  if (spectrumReady() && to) {
    try {
      await sendVoiceViaSpectrum(to, audio.bytes);
      meta.delivered = true;
    } catch (e) {
      console.warn("spectrum voice send failed, dashboard only:", e);
      meta.delivered = false;
    }
  }
  return record({
    channel: "imessage", direction: "out", counterparty: opts.counterparty,
    text: opts.text, audio_url: audio.url, meta,
  });
}

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
      console.warn(`spectrum send failed to ${to} on ${channel}, dashboard only:`, e);
      meta.delivered = false;
    }
  }
  return record({
    claim_id: opts.claimId ?? null, channel, direction: "out", counterparty: opts.counterparty,
    text, audio_url: opts.audio?.url ?? null, meta,
  });
}
