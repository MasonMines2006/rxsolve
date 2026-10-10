/**
 * Pharmacist Notifier (AGT-07). Owner: P2.
 * Digest copy is templated from ledger + db values; the model never improvises numbers.
 */
import type { ChannelMessage, Claim } from "@rxsolve/contracts";
import { config } from "../config";
import { getDb } from "../db";
import { ledgerSummary } from "../ledger/settle";
import { send } from "../messaging";
import { tts } from "../voice";

export async function summarizeDay(pharmacyId: string) {
  const claims = await getDb().claims.find({ pharmacy_id: pharmacyId });
  const flagged = claims.filter((c) => c.stage && c.stage !== "CLEARED");
  const count = (...stages: string[]) => claims.filter((c) => c.stage && stages.includes(c.stage)).length;
  const found_amt = flagged.reduce((s, c) => s + (c.verdict?.delta ?? 0), 0);
  const { recovered_to_date } = await ledgerSummary();
  return {
    found: flagged.length, found_amt, pending: count("FILED", "NEGOTIATING"),
    filed: count("FILED", "NEGOTIATING", "SETTLED"), recovered: recovered_to_date,
  };
}

export async function sendDigest(pharmacyId: string): Promise<ChannelMessage> {
  const s = await summarizeDay(pharmacyId);
  const day = new Date().toLocaleDateString("en-US", { month: "short", day: "numeric" });
  const text =
    `RxSolve ${day}: found ${s.found} underpaid claims ($${s.found_amt.toFixed(2)}). ` +
    `Filed ${s.filed}, ${s.pending} pending, recovered $${s.recovered.toFixed(2)}. Reply DETAILS or PAUSE.`;
  const audio = await tts(text); // null if ElevenLabs is not configured
  return send("imessage", config.pharmacistPhone, text, { counterparty: "pharmacist", audio });
}

export async function raiseException(claim: Claim, reason: string, ask = "Reply APPROVE to file or SKIP."): Promise<ChannelMessage> {
  const text = `RxSolve: ${claim.claim_id} (${claim.pbm}) needs you: ${reason}. ${ask}`;
  return send("imessage", config.pharmacistPhone, text, { counterparty: "pharmacist", claimId: claim.claim_id });
}

/** Inbound iMessage from the pharmacist. TODO(AGT-07): APPROVE <claim>, DETAILS, PAUSE, questions. */
export async function handleReply(text: string): Promise<string> {
  return `Got it: ${text.trim().slice(0, 40)}`;
}
