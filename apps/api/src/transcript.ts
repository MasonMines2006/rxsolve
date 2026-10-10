/** Record a message on any channel: stored in `transcript`, shown in the channel viewer or phone mock. Owner: P2. */
import type { ChannelMessage } from "@rxsolve/contracts";
import { getDb } from "./db";
import { bus } from "./events";

export type NewMessage = Omit<ChannelMessage, "ts" | "attachments" | "audio_url" | "meta" | "claim_id"> &
  Partial<Pick<ChannelMessage, "attachments" | "audio_url" | "meta" | "claim_id">>;

export async function record(m: NewMessage): Promise<ChannelMessage> {
  const msg: ChannelMessage = {
    claim_id: null, attachments: [], audio_url: null, meta: {}, ...m, ts: new Date().toISOString(),
  };
  await getDb().transcript.insert(msg);
  bus.emit(msg.channel === "imessage" ? "notifier.message" : "channel.message", msg.claim_id, msg);
  return msg;
}
