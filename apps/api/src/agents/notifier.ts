/**
 * Pharmacist Notifier (AGT-07). Owner: P2.
 * Digest and replies are templated from ledger + db values; the model never improvises numbers.
 */
import type { ChannelMessage, Claim } from "@rxsolve/contracts";
import { config } from "../config";
import { getDb, type ClaimRecord } from "../db";
import { bus } from "../events";
import { ledgerSummary } from "../ledger/settle";
import { send, sendVoice } from "../messaging";
import { approveClaim, getPolicy, setPolicy } from "../policy";
import { tts } from "../voice";

const money = (x: number) => `$${x.toFixed(2)}`;
const DAY_MS = 86_400_000;
const sameDay = (iso: string, now: Date) => new Date(iso).toDateString() === now.toDateString();

/** Counts come from the audit trail and remittances in the db, never from memory. */
export async function summarizeDay(pharmacyId: string, now = new Date()) {
  const db = getDb();
  const claims = await db.claims.find({ pharmacy_id: pharmacyId });
  const byId = new Map(claims.map((c) => [c.claim_id, c]));
  const audit = (await db.audit.find()).filter((a) => byId.has(a.claim_id));

  const foundToday = new Set(audit.filter((a) => a.stage !== "CLEARED" && sameDay(a.ts, now)).map((a) => a.claim_id));
  const filedToday = new Set(audit.filter((a) => a.stage === "FILED" && sameDay(a.ts, now)).map((a) => a.claim_id));
  const found_amt = [...foundToday].reduce((s, id) => s + (byId.get(id)?.verdict?.delta ?? 0), 0);

  const remits = (await db.remittances.find()).filter((r) => r.payee === pharmacyId);
  const sum = (rs: typeof remits) => Math.round(rs.reduce((s, r) => s + r.adjustment, 0) * 100) / 100;
  const recovered = sum(remits.filter((r) => sameDay(r.posted_at, now)));
  const week_recovered = sum(remits.filter((r) => now.getTime() - new Date(r.posted_at).getTime() < 7 * DAY_MS));

  const stageCount = (...st: string[]) => claims.filter((c) => c.stage && st.includes(c.stage)).length;
  return {
    found: foundToday.size, found_amt, filed: filedToday.size,
    pending: stageCount("FILED", "NEGOTIATING"), exceptions: stageCount("EXCEPTION"),
    recovered, week_recovered,
  };
}

type DaySummary = Awaited<ReturnType<typeof summarizeDay>>;

/** Text and spoken script come from one summary, so the voice note repeats the text's figures. */
export function digestScripts(s: DaySummary, now = new Date()) {
  const day = now.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  const need = s.exceptions ? ` ${s.exceptions} need you.` : "";
  const text =
    `RxSolve ${day}: found ${s.found} underpaid claims (${money(s.found_amt)}). ` +
    `Filed ${s.filed}, ${s.pending} pending, recovered ${money(s.recovered)}. ` +
    `This week: ${money(s.week_recovered)}.${need} Reply DETAILS or PAUSE.`;
  const spoken =
    `RxSolve recap for ${day}. Found ${s.found} underpaid claims, ${money(s.found_amt)} in total. ` +
    `Filed ${s.filed}, ${s.pending} pending, recovered ${money(s.recovered)}. ` +
    `This week, ${money(s.week_recovered)} recovered.${need} Reply DETAILS or PAUSE.`;
  return { text, spoken };
}

type Speaker = (text: string) => Promise<{ bytes: Uint8Array; url: string } | null>;
let speak: Speaker = tts;
let recap: Promise<ChannelMessage | null> = Promise.resolve(null);

/** Tests swap ElevenLabs for a stub; null restores it. */
export function setSpeaker(fn: Speaker | null) {
  speak = fn ?? tts;
}

/** Settles with the voice-note message, or null when TTS is off or failed. Never rejects. */
export const voiceRecapDone = () => recap;

/** The text goes out first; the voice note follows as its own message and never delays or blocks it. */
export async function sendDigest(pharmacyId: string): Promise<ChannelMessage> {
  const { text, spoken } = digestScripts(await summarizeDay(pharmacyId));
  const msg = await send("imessage", config.pharmacistPhone, text, { counterparty: "pharmacist" });
  recap = (async () => {
    try {
      const audio = await speak(spoken);
      if (!audio) return null;
      return await sendVoice(config.pharmacistPhone, audio, {
        counterparty: "pharmacist", text: "Voice recap", meta: { recap_of: msg.ts },
      });
    } catch (e) {
      console.warn("voice recap dropped:", e);
      return null;
    }
  })();
  return msg;
}

const POLICY_REASON = /auto-file limit|paused/;

/** Only policy exceptions can be approved into filing; incomplete or marginal ones offer DETAILS/SKIP. */
export async function raiseException(claim: Claim, reason: string, ask?: string): Promise<ChannelMessage> {
  const delta = (await getDb().claims.get(claim.claim_id))?.verdict?.delta;
  const amount = delta ? ` (${money(delta)} short)` : "";
  const id = claim.claim_id;
  const defaultAsk = POLICY_REASON.test(reason)
    ? `Reply APPROVE ${id} to file or SKIP ${id}.`
    : `Reply DETAILS ${id} to review or SKIP ${id}.`;
  const text = `RxSolve: ${id} (${claim.pbm})${amount} needs you: ${reason}. ${ask ?? defaultAsk}`;
  return send("imessage", config.pharmacistPhone, text, { counterparty: "pharmacist", claimId: id });
}

type Refile = (claimId: string) => Promise<void>;
const rerunOrchestrator: Refile = async (id) => (await import("../orchestrator")).processClaimSafe(id);
let refile: Refile = rerunOrchestrator;

/** Tests swap the orchestrator re-run for a stub; null restores it. */
export function setRefileHandler(fn: Refile | null) {
  refile = fn ?? rerunOrchestrator;
}

const HELP = "Commands: APPROVE <claim>, SKIP <claim>, DETAILS [claim], PAUSE, RESUME, LIMIT <dollars>.";

async function resolveTarget(pharmacyId: string, id: string | null) {
  const claims = await getDb().claims.find({ pharmacy_id: pharmacyId });
  const open = claims.filter((c) => c.stage === "EXCEPTION");
  if (id) return { claim: claims.find((c) => c.claim_id === id) ?? null, id, open };
  if (open.length === 1) return { claim: open[0]!, id: open[0]!.claim_id, open };
  return { claim: null as ClaimRecord | null, id: null, open };
}

const ambiguous = (open: ClaimRecord[], verb: string) =>
  open.length === 0
    ? "Nothing is waiting on you."
    : `Which claim? Reply ${verb} <claim> for one of: ${open.map((c) => c.claim_id).join(", ")}.`;

async function approve(pharmacyId: string, idArg: string | null): Promise<string> {
  const { claim, id, open } = await resolveTarget(pharmacyId, idArg);
  if (!id) return ambiguous(open, "APPROVE");
  if (!claim) return `I do not know ${id}.`;
  if (claim.stage !== "EXCEPTION") return `${id} is not waiting on you (stage ${claim.stage ?? "unknown"}).`;
  const ev = await getDb().evidence.get(id);
  if (claim.verdict?.verdict !== "UNDERWATER" || !ev || ev.completeness < 1)
    return `${id} cannot be filed: ${claim.reason ?? "evidence incomplete"}. Reply SKIP ${id} to close it.`;
  await approveClaim(pharmacyId, id);
  void refile(id);
  return `Approved ${id} (${money(ev.delta)}). Filing now.`;
}

async function skip(pharmacyId: string, idArg: string | null): Promise<string> {
  const { claim, id, open } = await resolveTarget(pharmacyId, idArg);
  if (!id) return ambiguous(open, "SKIP");
  if (!claim) return `I do not know ${id}.`;
  if (claim.stage !== "EXCEPTION") return `${id} is not waiting on you (stage ${claim.stage ?? "unknown"}).`;
  const reason = "skipped by pharmacist";
  await getDb().claims.patch(id, { stage: "ABANDONED", reason });
  await getDb().audit.insert({ claim_id: id, ts: new Date().toISOString(), stage: "ABANDONED", reason });
  bus.emit("claim.stage", id, { stage: "ABANDONED", reason });
  return `Skipped ${id}. It will not be filed.`;
}

async function details(pharmacyId: string, id: string | null): Promise<string> {
  if (id) {
    const c = await getDb().claims.get(id);
    if (!c) return `I do not know ${id}.`;
    const acq = c.acquisition_cost === null ? "unknown" : money(c.acquisition_cost);
    return (
      `${id} (${c.pbm}, ${c.state}): paid ${money(c.paid_amount)}, acquisition cost ${acq}, ` +
      `short ${money(c.verdict?.delta ?? 0)}. Stage ${c.stage ?? "RECEIVED"}${c.reason ? ` (${c.reason})` : ""}.`
    );
  }
  const flagged = (await getDb().claims.find({ pharmacy_id: pharmacyId })).filter((c) => c.stage && c.stage !== "CLEARED");
  if (flagged.length === 0) return "No flagged claims yet.";
  const rows = flagged.slice(0, 5).map((c) => `${c.claim_id} ${c.stage} ${money(c.verdict?.delta ?? 0)}`);
  return `${flagged.length} flagged: ${rows.join("; ")}${flagged.length > 5 ? "; ..." : ""}.`;
}

async function status(pharmacyId: string): Promise<string> {
  const s = await summarizeDay(pharmacyId);
  const { recovered_to_date, fees_to_date } = await ledgerSummary();
  return (
    `Recovered ${money(recovered_to_date)} to date (fees ${money(fees_to_date)}). ` +
    `${s.pending} pending, ${s.exceptions} need you. ${HELP}`
  );
}

/** Inbound iMessage from the pharmacist. Commands change real state; anything else gets a ledger answer. */
export async function handleReply(text: string, pharmacyId = config.pharmacyId): Promise<string> {
  const words = text.trim().split(/\s+/);
  const cmd = (words[0] ?? "").toUpperCase().replace(/[^A-Z]/g, "");
  const rest = words.slice(1).join(" ");
  const id = /RXS-\d+/i.exec(rest)?.[0]?.toUpperCase() ?? null;

  switch (cmd) {
    case "APPROVE": case "YES":
      return approve(pharmacyId, id);
    case "SKIP":
      return skip(pharmacyId, id);
    case "DETAILS":
      return details(pharmacyId, id);
    case "PAUSE": case "STOP":
      await setPolicy({ ...(await getPolicy(pharmacyId)), paused: true });
      return "Auto-filing paused. Nothing will be filed without your APPROVE. Reply RESUME to restart.";
    case "RESUME":
      await setPolicy({ ...(await getPolicy(pharmacyId)), paused: false });
      return "Auto-filing resumed within your standing limit.";
    case "LIMIT": {
      const n = Number(rest.replace(/[$,]/g, ""));
      if (!Number.isFinite(n) || n <= 0) return "Reply LIMIT <dollars>, for example LIMIT 250.";
      await setPolicy({ ...(await getPolicy(pharmacyId)), auto_file_max: n });
      return `Standing authorization set: auto-file underpayments up to ${money(n)} with complete evidence.`;
    }
    default:
      return status(pharmacyId);
  }
}
