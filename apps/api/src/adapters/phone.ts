/**
 * PhoneAdapter (AGT-08, stretch). Owner: P2.
 * Calls the PBM rep line over a WebSocket audio interface and argues a disputed denial. The rep's
 * concede/deny is the PBM side's deterministic rule; the agent only argues and listens.
 *
 * Wire protocol (JSON text frames), the hook point for real telephony (a bridge to a phone line):
 *   agent -> rep: {type:"start", claim_id, pbm} then {type:"audio", data:<base64>} per utterance
 *   rep -> agent: {type:"audio", data:<base64>} and optionally {type:"decision", status, delta, text}
 * PHONE_REP_URL points at the line; PHONE_MODE=sim starts the in-process simulated rep.
 */
import type { Channel, Claim, Decision, Evidence, Reply, Ticket } from "@rxsolve/contracts";
import { type Ask } from "../agents/entitlement";
import { readRepLine, spokenCitation } from "../agents/phone-text";
import { record } from "../transcript";
import type { ChannelAdapter } from "./index";
import { type Codec, defaultCodec } from "./phone-audio";
import { startRepSim } from "./phone-sim/rep";

export const phoneConfig = { maxTurns: 3, turnTimeoutMs: 15_000, callTimeoutMs: 90_000, graceMs: 250 };

export type PhoneOpts = {
  repUrl?: string;
  codec?: Codec;
  ask?: Ask;
  maxTurns?: number;
  turnTimeoutMs?: number;
  callTimeoutMs?: number;
  /** Calendar deadline of the appeal window; the call never runs past it. */
  appealDeadline?: string | null;
  now?: Date;
};

export type PhoneResult = {
  status: "APPROVED" | "DENIED";
  delta: number | null;
  raw: string;
  turns: number;
  ref: string;
};

export class PhoneError extends Error {}

type Frame = { type: string; data?: string; status?: string; delta?: number | null; text?: string };

let sim: ReturnType<typeof startRepSim> | null = null;

/** The configured line: explicit URL, PHONE_REP_URL, or the lazily started in-process simulator. */
function line(url?: string): { url: string; register?: (id: string, c: { statute: string; delta: number }) => void } | null {
  if (url) return { url };
  const env = process.env.PHONE_REP_URL;
  if (env) return { url: env };
  if (process.env.PHONE_MODE === "sim") {
    sim ??= startRepSim({ codec: defaultCodec() });
    return { url: sim.url, register: sim.register };
  }
  return null;
}

export const phoneConfigured = (url?: string) => line(url) !== null;

export function stopPhoneSim() {
  sim?.stop();
  sim = null;
}

const b64 = (u: Uint8Array) => Buffer.from(u).toString("base64");

/** Places one call. Throws PhoneError when the line is unreachable, silent, or out of time. */
export async function placeCall(claim: Claim, ev: Evidence, o: PhoneOpts = {}): Promise<PhoneResult> {
  const l = line(o.repUrl);
  if (!l) throw new PhoneError("no rep line configured");
  const codec = o.codec ?? defaultCodec();
  const maxTurns = o.maxTurns ?? phoneConfig.maxTurns;
  const turnMs = o.turnTimeoutMs ?? phoneConfig.turnTimeoutMs;
  const now = o.now ?? new Date();
  const toDeadline = o.appealDeadline ? Date.parse(`${o.appealDeadline}T23:59:59Z`) - now.getTime() : Infinity;
  if (toDeadline <= 0) throw new PhoneError("appeal deadline passed before the call");
  const budget = Math.min(o.callTimeoutMs ?? phoneConfig.callTimeoutMs, toDeadline);
  const endAt = Date.now() + budget;
  const ref = `CALL-${claim.claim_id}-${Date.now().toString(36)}`;
  l.register?.(claim.claim_id, { statute: ev.statute, delta: ev.delta });

  const log = (direction: "in" | "out", text: string, turn: number) =>
    record({ claim_id: claim.claim_id, channel: "phone", direction, counterparty: claim.pbm, text, meta: { ref, turn, codec: codec.name } });

  const ws = new WebSocket(l.url);
  const queue: Frame[] = [];
  let wake: (() => void) | null = null;
  let closed = false;
  ws.onmessage = (m) => {
    try {
      queue.push(JSON.parse(String(m.data)) as Frame);
    } catch {
      /* ignore non-JSON frames */
    }
    wake?.();
  };
  ws.onclose = ws.onerror = () => {
    closed = true;
    wake?.();
  };
  const next = async (ms: number): Promise<Frame | null> => {
    const until = Math.min(Date.now() + ms, endAt);
    while (!queue.length) {
      if (closed || Date.now() >= until) return null;
      await new Promise<void>((res) => {
        wake = res;
        setTimeout(res, Math.max(1, until - Date.now()));
      });
    }
    return queue.shift()!;
  };
  /** The next audio frame, transcribed; a decision frame seen on the way is returned too. */
  const hear = async (ms: number): Promise<{ text: string; decision: Frame | null } | null> => {
    let decision: Frame | null = null;
    for (;;) {
      const f = await next(ms);
      if (!f) return null;
      if (f.type === "decision") {
        decision = f;
        continue;
      }
      if (f.type === "audio" && f.data) {
        const text = (await codec.stt(new Uint8Array(Buffer.from(f.data, "base64")))).trim();
        if (!decision && !queue.length) await new Promise((r) => (wake = () => r(null), setTimeout(r, phoneConfig.graceMs)));
        const i = queue.findIndex((q) => q.type === "decision");
        return { text, decision: decision ?? (i >= 0 ? queue.splice(i, 1)[0]! : null) };
      }
    }
  };

  try {
    await new Promise<void>((res, rej) => {
      const t = setTimeout(() => rej(new PhoneError("rep line connect timeout")), Math.min(turnMs, budget));
      ws.addEventListener("open", () => (clearTimeout(t), res()));
      ws.addEventListener("error", () => (clearTimeout(t), rej(new PhoneError("rep line unreachable"))));
    });
    ws.send(JSON.stringify({ type: "start", claim_id: claim.claim_id, pbm: claim.pbm }));
    let rep = await hear(turnMs);
    if (!rep) throw new PhoneError("rep did not pick up");
    await log("in", rep.text, 0);

    for (let turn = 0; turn < maxTurns; turn++) {
      if (Date.now() >= endAt) throw new PhoneError("call ran out of time");
      const say = await spokenCitation(ev, turn, rep.text, o.ask);
      ws.send(JSON.stringify({ type: "audio", data: b64(await codec.tts(say)) }));
      await log("out", say, turn + 1);
      rep = await hear(turnMs);
      if (!rep) throw new PhoneError("rep went silent");
      await log("in", rep.text, turn + 1);

      // The engine's decision frame is authoritative; without one, the transcript is read.
      const d = rep.decision;
      if (d?.status === "APPROVED" || d?.status === "DENIED") {
        return { status: d.status, delta: d.status === "APPROVED" ? (d.delta ?? ev.delta) : null, raw: d.text ?? rep.text, turns: turn + 1, ref };
      }
      const read = await readRepLine(rep.text, o.ask);
      if (read === "approved") return { status: "APPROVED", delta: ev.delta, raw: rep.text, turns: turn + 1, ref };
      if (read === "denied") return { status: "DENIED", delta: null, raw: rep.text, turns: turn + 1, ref };
    }
    return { status: "DENIED", delta: null, raw: rep.text, turns: maxTurns, ref };
  } finally {
    ws.onclose = ws.onerror = null;
    try {
      ws.close();
    } catch {
      /* already closed */
    }
  }
}

/** ChannelAdapter view of the phone line: submit places the call, poll reports its outcome. */
export class PhoneAdapter implements ChannelAdapter {
  channel: Channel = "phone";
  private results = new Map<string, { claim: Claim; ev: Evidence; result: PhoneResult }>();
  private n = 0;

  constructor(private opts: PhoneOpts = {}) {}

  private async dial(claim: Claim, ev: Evidence): Promise<Ticket> {
    const result = await placeCall(claim, ev, { ...this.opts, appealDeadline: ev.appeal_deadline });
    const ticket_id = `PHONE-${++this.n}`;
    this.results.set(ticket_id, { claim, ev, result });
    const at = new Date().toISOString();
    return { claim_id: claim.claim_id, pbm: claim.pbm, channel: "phone", ticket_id, submitted_at: at, expected_response_by: at };
  }

  submit(claim: Claim, ev: Evidence) {
    return this.dial(claim, ev);
  }

  async poll(ticket: Ticket): Promise<Decision | null> {
    const r = this.results.get(ticket.ticket_id);
    if (!r) return null;
    return {
      claim_id: ticket.claim_id, ticket_id: ticket.ticket_id, status: r.result.status,
      reason: r.result.status === "DENIED" ? "disputed" : null, field: null, delta: r.result.delta, raw: r.result.raw,
    };
  }

  async reply(ticket: Ticket, msg: Reply): Promise<Ticket> {
    const prior = this.results.get(ticket.ticket_id);
    if (!prior) throw new PhoneError(`unknown phone ticket ${ticket.ticket_id}`);
    return this.dial(prior.claim, msg.evidence);
  }
}
