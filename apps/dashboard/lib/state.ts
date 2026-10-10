/** Folds /ws/live events into what the panels render. Owner: P3. Pure: easy to unit test. */
import type {
  Action, ChannelMessage, Claim, Decision, Evidence, LedgerSummary, LiveEvent, Stage, Ticket, Verdict,
} from "@rxsolve/contracts";

export type ClaimView = {
  claim: Claim & { drug: string };
  stage?: Stage;
  reason?: string;
  verdict?: Verdict;
  evidence?: Evidence;
  ticket?: Ticket;
  decisions: Decision[];
  actions: Action[];
};

export type LiveState = {
  claims: Record<string, ClaimView>;
  order: string[]; // claim ids, newest first
  messages: ChannelMessage[]; // channel viewer (portal, email, fax, whatsapp, sms)
  phone: ChannelMessage[]; // pharmacist iMessage thread
  ledger: LedgerSummary | null;
  log: LiveEvent[];
};

export const initialState: LiveState = { claims: {}, order: [], messages: [], phone: [], ledger: null, log: [] };

type Msg = { type: "reset" } | { type: "event"; event: LiveEvent };

export function reduce(s: LiveState, m: Msg): LiveState {
  if (m.type === "reset") return initialState;
  const e = m.event;
  const s2 = { ...s, log: [...s.log.slice(-499), e] };
  const patch = (id: string | null, p: Partial<ClaimView>) => {
    if (!id || !s2.claims[id]) return;
    s2.claims = { ...s2.claims, [id]: { ...s2.claims[id]!, ...p } };
  };
  const cur = e.claim_id ? s2.claims[e.claim_id] : undefined;
  switch (e.type) {
    case "claim.received":
      s2.claims = { ...s2.claims, [e.payload.claim_id]: { claim: e.payload, decisions: [], actions: [] } };
      s2.order = [e.payload.claim_id, ...s2.order.filter((x) => x !== e.payload.claim_id)];
      break;
    case "claim.stage": patch(e.claim_id, { stage: e.payload.stage, reason: e.payload.reason }); break;
    case "verdict": patch(e.claim_id, { verdict: e.payload }); break;
    case "evidence.built": patch(e.claim_id, { evidence: e.payload }); break;
    case "appeal.filed": patch(e.claim_id, { ticket: e.payload }); break;
    case "appeal.decision": patch(e.claim_id, { decisions: [...(cur?.decisions ?? []), e.payload] }); break;
    case "negotiation.action":
      patch(e.claim_id, { actions: [...(cur?.actions ?? []), e.payload], ticket: e.payload.ticket ?? cur?.ticket });
      break;
    case "channel.message": s2.messages = [...s2.messages, e.payload]; break;
    case "notifier.message": s2.phone = [...s2.phone, e.payload]; break;
    case "ledger.balances": s2.ledger = e.payload; break;
    case "ledger.settled":
    case "exception.raised":
      break; // shown via stage + log; panels may want them later
  }
  return s2;
}
