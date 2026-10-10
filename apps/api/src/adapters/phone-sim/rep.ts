/**
 * Simulated PBM rep line (AGT-08). Owner: P2.
 * A WebSocket audio endpoint speaking the phone protocol (see adapters/phone.ts). The rep's outcome
 * is a fixed rule over what it heard: concede when the caller cites the statute on file and states
 * the underpayment figure; after maxTurns without both, deny. No model is involved.
 */
import { type Codec, stubCodec } from "../phone-audio";

export type RepCase = { statute: string; delta: number };
export type RepOpts = { codec?: Codec; maxTurns?: number; port?: number; silent?: boolean };

const b64 = (u: Uint8Array) => Buffer.from(u).toString("base64");
const unb64 = (s: string) => new Uint8Array(Buffer.from(s, "base64"));

/** The deterministic concession rule. */
export function repConcedes(heard: string, c: RepCase): boolean {
  return heard.toLowerCase().includes(c.statute.toLowerCase()) && heard.includes(`$${c.delta.toFixed(2)}`);
}

export function startRepSim(opts: RepOpts = {}) {
  const codec = opts.codec ?? stubCodec;
  const maxTurns = opts.maxTurns ?? 3;
  const cases = new Map<string, RepCase>();
  const server = Bun.serve<{ claim?: string; turns: number }>({
    port: opts.port ?? 0,
    fetch(req, s) {
      return s.upgrade(req, { data: { turns: 0 } }) ? undefined : new Response("websocket only", { status: 426 });
    },
    websocket: {
      async message(ws, raw) {
        if (opts.silent) return;
        const say = async (text: string) => ws.send(JSON.stringify({ type: "audio", data: b64(await codec.tts(text)) }));
        const f = JSON.parse(String(raw)) as { type: string; claim_id?: string; data?: string };
        if (f.type === "start") {
          ws.data.claim = f.claim_id;
          await say(`Appeals line. Claim ${f.claim_id}, the appeal was denied as a disputed rate. What is your basis?`);
          return;
        }
        const c = ws.data.claim ? cases.get(ws.data.claim) : undefined;
        if (f.type !== "audio" || !f.data || !c) return;
        ws.data.turns++;
        const heard = await codec.stt(unb64(f.data));
        const decide = async (status: "APPROVED" | "DENIED", text: string) => {
          await say(text);
          ws.send(JSON.stringify({ type: "decision", status, reason: status === "DENIED" ? "disputed" : null, delta: status === "APPROVED" ? c.delta : null, text }));
        };
        if (repConcedes(heard, c)) return decide("APPROVED", `Confirmed. The appeal is approved and the adjustment of $${c.delta.toFixed(2)} will post.`);
        if (ws.data.turns >= maxTurns) return decide("DENIED", "I cannot adjust this claim. The denial stands.");
        await say("I still need the statute and the exact underpayment amount.");
      },
    },
  });
  return {
    url: `ws://localhost:${server.port}`,
    register: (claimId: string, c: RepCase) => void cases.set(claimId, c),
    stop: () => server.stop(true),
  };
}
