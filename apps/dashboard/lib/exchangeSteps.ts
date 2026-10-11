/** Groups channel messages into display steps with honest delivery chips. Owner: P3. Pure. */
import type { ChannelMessage } from "@rxsolve/contracts";

export type ChipKind = "delivered" | "not-delivered" | "simulated";
export type Chip = { kind: ChipKind; label: string };

export type Step =
  | { type: "message"; msg: ChannelMessage; chip: Chip | null }
  | { type: "fallback"; first: ChannelMessage; second: ChannelMessage; label: string; chip: Chip };

/** Channels that go through the messaging transport, where delivery is a real question. */
const TRANSPORT = new Set(["whatsapp", "sms", "imessage"]);
export const FALLBACK_WINDOW_MS = 10_000;

const word = (m: ChannelMessage) => (m.meta.delivered === true ? "delivered" : m.meta.delivered === false ? "not delivered" : "simulated");
const chan = (c: string) => (c === "whatsapp" ? "WhatsApp" : c === "sms" ? "SMS" : c);

/** Chip for one message: outbound transport sends read meta.delivered, stub replies are simulated. */
export function chipFor(m: ChannelMessage): Chip | null {
  if (m.direction === "in") return m.meta.stub === true ? { kind: "simulated", label: "Simulated reply (demo stub)" } : null;
  if (!TRANSPORT.has(m.channel)) return null;
  if (m.meta.delivered === true) return { kind: "delivered", label: "Delivered" };
  if (m.meta.delivered === false) return { kind: "not-delivered", label: "Not delivered" };
  return { kind: "simulated", label: "Simulated" };
}

const isRetry = (a: ChannelMessage, b: ChannelMessage) =>
  a.direction === "out" && b.direction === "out" && a.channel === "whatsapp" && b.channel === "sms"
  && a.claim_id === b.claim_id && a.counterparty === b.counterparty && a.text === b.text
  && Math.abs(Date.parse(b.ts) - Date.parse(a.ts)) <= FALLBACK_WINDOW_MS;

export function groupExchange(messages: readonly ChannelMessage[]): Step[] {
  const out: Step[] = [];
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i]!;
    const next = messages[i + 1];
    if (next && isRetry(m, next)) {
      out.push({
        type: "fallback", first: m, second: next,
        label: `${chan(m.channel)} ${word(m)}, retried by ${chan(next.channel)} (${word(next)})`,
        chip: chipFor(next)!,
      });
      i++;
    } else out.push({ type: "message", msg: m, chip: chipFor(m) });
  }
  return out;
}
