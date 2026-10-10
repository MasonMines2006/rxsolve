/**
 * Shared contracts between P1, P2 and P3: DESIGN.md section 5.3 and the /ws/live events.
 *
 * SHARED FILE. The API, the agents and the dashboard all import from here, so a change here is a
 * change for everyone. Changing a shape means a line in docs/DECISIONS.md and saying so in the
 * commit message. Adding an optional field is fine; never rename or remove one silently.
 *
 * Every shape is a zod schema (validate at HTTP edges and on model output) plus its inferred type.
 * The PBM Sim does NOT import this package: it is a stand-in for a real PBM.
 */
import { z } from "zod";

export const PBM = z.enum(["PBM_PORTAL", "PBM_EMAIL", "PBM_FAX"]);
export type PBM = z.infer<typeof PBM>;

export const Channel = z.enum(["portal", "email", "fax", "phone"]);
export type Channel = z.infer<typeof Channel>;

export const MessageChannel = z.enum(["portal", "email", "fax", "phone", "whatsapp", "sms", "imessage"]);
export type MessageChannel = z.infer<typeof MessageChannel>;

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD");
const isoDateTime = z.string(); // ISO 8601, UTC

// ---------------------------------------------------------------- claim

/** NCPDP-shaped message carried verbatim. Keys are real D.0 field IDs (verified in RES-01). */
export const NCPDP = z.object({
  transaction: z.enum(["B1", "B2", "B3"]).default("B1"),
  request: z.record(z.string(), z.unknown()),
  response: z.record(z.string(), z.unknown()).nullable().optional(),
});
export type NCPDP = z.infer<typeof NCPDP>;

export const Claim = z.object({
  claim_id: z.string(),
  pharmacy_id: z.string(),
  pbm: PBM,
  state: z.string(),
  plan: z.string(),
  patient_ref: z.string(), // opaque; never real PHI
  ndc: z.string(),
  qty: z.number(),
  fill_date: isoDate,
  paid_amount: z.number(),
  // Never from the claim message: invoice store, NADAC fixture, contract table.
  acquisition_cost: z.number().nullable(),
  nadac: z.number().nullable(),
  contract_rate: z.number().nullable(),
  ncpdp: NCPDP.optional(),
});
export type Claim = z.infer<typeof Claim>;

// ---------------------------------------------------------------- watcher

export const VerdictKind = z.enum(["CLEAR", "MARGINAL", "UNDERWATER"]);
export type VerdictKind = z.infer<typeof VerdictKind>;

export const Verdict = z.object({
  claim_id: z.string(),
  verdict: VerdictKind,
  delta: z.number(),
  benchmark_used: z.string().nullable(),
  appeal_deadline: isoDate.nullable(),
  confidence: z.number(),
});
export type Verdict = z.infer<typeof Verdict>;

// ---------------------------------------------------------------- evidence

export const Evidence = z.object({
  claim_id: z.string(),
  statute: z.string(),
  entitlement: z.string(),
  attachments: z.array(z.string()),
  required_fields_present: z.array(z.string()),
  spec_version: z.string(),
  completeness: z.number(),
  // Additive to the DESIGN 5.3 example: the values adapters put on the PBM's form, the amount
  // appealed, and the deadline carried through from the verdict.
  fields: z.record(z.string(), z.unknown()),
  delta: z.number(),
  appeal_deadline: isoDate.nullable(),
});
export type Evidence = z.infer<typeof Evidence>;

// ---------------------------------------------------------------- filing / negotiation

export const Ticket = z.object({
  claim_id: z.string(),
  pbm: PBM,
  channel: Channel,
  ticket_id: z.string(),
  submitted_at: isoDateTime,
  expected_response_by: isoDateTime,
});
export type Ticket = z.infer<typeof Ticket>;

export const DenialReason = z.enum([
  "missing_field",
  "insufficient_evidence",
  "disputed",
  "window_expired",
  "not_eligible",
]);
export type DenialReason = z.infer<typeof DenialReason>;

export const Decision = z.object({
  claim_id: z.string(),
  ticket_id: z.string(),
  status: z.enum(["APPROVED", "DENIED"]),
  reason: DenialReason.nullable(),
  field: z.string().nullable(), // set when reason == "missing_field"
  delta: z.number().nullable(), // set when APPROVED
  raw: z.string().nullable(), // the PBM's words as read off its channel
});
export type Decision = z.infer<typeof Decision>;

export const Reply = z.object({ evidence: Evidence, note: z.string().optional() });
export type Reply = z.infer<typeof Reply>;

export const ActionKind = z.enum(["REFILED", "ESCALATED", "EXTERNAL_APPEAL", "ABANDONED"]);
export type ActionKind = z.infer<typeof ActionKind>;

export const Action = z.object({
  kind: ActionKind,
  ticket: Ticket.optional(),
  evidence: Evidence.optional(),
  reason: z.string().optional(),
});
export type Action = z.infer<typeof Action>;

// ---------------------------------------------------------------- ledger

export const Transfer = z.object({
  from: z.string(),
  to: z.string(),
  amount: z.number(),
  kind: z.enum(["remittance_adjustment", "contingency_fee", "reversal", "opening"]),
  memo: z.string().optional(),
});
export type Transfer = z.infer<typeof Transfer>;

export const LedgerSettlement = z.object({
  event: z.literal("RECOVERY_SETTLED"),
  claim_id: z.string(),
  transfers: z.array(Transfer),
});
export type LedgerSettlement = z.infer<typeof LedgerSettlement>;

/** 835-style remittance record (DESIGN 5.4). The Nessie deposit memo references remittance_id. */
export const Remittance = z.object({
  remittance_id: z.string(),
  type: z.literal("835-style"),
  payer: z.string(),
  payee: z.string(),
  claim_id: z.string(),
  paid_original: z.number(),
  adjustment: z.number(),
  paid_total: z.number(),
  reason: z.string(),
  posted_at: isoDateTime,
});
export type Remittance = z.infer<typeof Remittance>;

export const LedgerSummary = z.object({
  balances: z.record(z.string(), z.number()),
  recovered_to_date: z.number(), // computed from ledger events, never a stored counter
  fees_to_date: z.number(),
});
export type LedgerSummary = z.infer<typeof LedgerSummary>;

/** One time bucket of settled recoveries (GET /api/ledger/series). On TigerData it comes from a continuous aggregate. */
export const RecoveryPoint = z.object({
  bucket: isoDateTime, // bucket start
  recovered: z.number(), // remittance adjustments settled in this bucket
  fees: z.number(),
  settlements: z.number(),
});
export type RecoveryPoint = z.infer<typeof RecoveryPoint>;

// ---------------------------------------------------------------- orchestration

/** Pipeline board columns (DESIGN 12). CLEARED claims never appear on the board. */
export const Stage = z.enum([
  "CLEARED",
  "DETECTED",
  "EVIDENCE",
  "FILED",
  "NEGOTIATING",
  "SETTLED",
  "ESCALATED",
  "ABANDONED",
  "EXCEPTION", // waiting on the pharmacist (outside standing authorization)
]);
export type Stage = z.infer<typeof Stage>;
export const TERMINAL_STAGES: readonly Stage[] = ["CLEARED", "SETTLED", "ESCALATED", "ABANDONED", "EXCEPTION"];

export const Outcome = z.object({
  claim_id: z.string(),
  stage: Stage,
  delta: z.number(),
  reason: z.string().optional(),
});
export type Outcome = z.infer<typeof Outcome>;

// ---------------------------------------------------------------- messages on any channel

/** One message on one channel. Also the shape stored in the `transcript` collection. */
export const ChannelMessage = z.object({
  claim_id: z.string().nullable(),
  channel: MessageChannel,
  direction: z.enum(["out", "in"]), // relative to RxSolve
  counterparty: z.string(), // "PBM_PORTAL", "wholesaler", "pharmacist", ...
  text: z.string(),
  attachments: z.array(z.string()).default([]),
  audio_url: z.string().nullable().default(null),
  meta: z.record(z.string(), z.unknown()).default({}),
  ts: isoDateTime,
});
export type ChannelMessage = z.infer<typeof ChannelMessage>;

// ---------------------------------------------------------------- /ws/live

/** Event type -> payload. The dashboard switches on `type`. */
export type LivePayloads = {
  "claim.received": Claim & { drug: string };
  "claim.stage": { stage: Stage; reason?: string };
  verdict: Verdict;
  "evidence.built": Evidence;
  "appeal.filed": Ticket;
  "appeal.decision": Decision;
  "negotiation.action": Action;
  "channel.message": ChannelMessage; // channel viewer (portal, email, fax, whatsapp, sms)
  "notifier.message": ChannelMessage; // pharmacist phone (imessage)
  "ledger.settled": LedgerSettlement & { remittance: Remittance };
  "ledger.balances": LedgerSummary;
  "exception.raised": { reason: string; ask: string };
};
export type EventType = keyof LivePayloads;
export const EVENT_TYPES = [
  "claim.received",
  "claim.stage",
  "verdict",
  "evidence.built",
  "appeal.filed",
  "appeal.decision",
  "negotiation.action",
  "channel.message",
  "notifier.message",
  "ledger.settled",
  "ledger.balances",
  "exception.raised",
] as const satisfies readonly EventType[];

export type LiveEvent<T extends EventType = EventType> = {
  [K in T]: { type: K; ts: string; claim_id: string | null; payload: LivePayloads[K] };
}[T];
