/** Pure view helpers over ClaimView for the claim list, journey and cashier panels. */
import type { Stage } from "@rxsolve/contracts";
import type { LiveState, ClaimView } from "./state";

export type Tone = "good" | "bad" | "warn" | "info" | "muted";

export const JOURNEY_STAGES = ["DETECTED", "EVIDENCE", "FILED", "NEGOTIATING", "SETTLED"] as const;

const STAGE_TONE: Record<Stage, Tone> = {
  CLEARED: "good",
  DETECTED: "warn",
  EVIDENCE: "info",
  FILED: "info",
  NEGOTIATING: "warn",
  SETTLED: "good",
  ESCALATED: "warn",
  ABANDONED: "muted",
  EXCEPTION: "bad",
};

export const stageTone = (stage: Stage | undefined): Tone => (stage ? STAGE_TONE[stage] : "muted");

export const isRecovery = (view: ClaimView) =>
  view.verdict?.verdict !== "CLEAR" && view.stage !== "CLEARED";

/** Claims that need or had recovery work, newest first. Claims without a verdict yet are included. */
export function recoveryClaims(live: Pick<LiveState, "claims" | "order">): { claimId: string; view: ClaimView }[] {
  const ids = [...new Set([...live.order, ...Object.keys(live.claims)])];
  return ids.flatMap((claimId) => {
    const view = live.claims[claimId];
    return view && isRecovery(view) ? [{ claimId, view }] : [];
  });
}

export type StepState = { stage: (typeof JOURNEY_STAGES)[number]; state: "done" | "now" | "skip" | "todo" };

/** Position of a stage on the five-step track. EXCEPTION sits at EVIDENCE; end states sit at NEGOTIATING. */
function rank(stage: Stage | undefined): number {
  switch (stage) {
    case "DETECTED": return 0;
    case "EVIDENCE": case "EXCEPTION": return 1;
    case "FILED": return 2;
    case "NEGOTIATING": case "ESCALATED": case "ABANDONED": return 3;
    case "SETTLED": return 4;
    default: return -1;
  }
}

export function journeySteps(view: ClaimView): StepState[] {
  const at = rank(view.stage);
  const settled = view.stage === "SETTLED";
  const denied = view.decisions.some((d) => d.status === "DENIED") || view.stage === "NEGOTIATING";
  return JOURNEY_STAGES.map((stage, i) => {
    if (stage === "NEGOTIATING" && !denied && (settled || at > 3)) return { stage, state: "skip" };
    if (settled || i < at) return { stage, state: "done" };
    return { stage, state: i === at ? "now" : "todo" };
  });
}

const DOOR: Record<string, string> = { portal: "web portal", email: "inbox", fax: "fax line", phone: "phone line" };
export const doorWord = (channel: string | undefined) => (channel && DOOR[channel]) || "channel";

const readable = (s: string) => s.replaceAll("_", " ").toLowerCase();

/** One sentence on where the claim is, built only from live fields. */
export function statusSentence(view: ClaimView, usd: (n: number | null | undefined) => string): string {
  const door = doorWord(view.ticket?.channel);
  const last = view.decisions.at(-1);
  switch (view.stage) {
    case "DETECTED": return "Caught at the register: the PBM paid below what the drug cost.";
    case "EVIDENCE": return "Building proof from the pharmacy invoice and the state statute.";
    case "FILED": return `Appeal filed through the PBM's ${door}. Waiting for its decision.`;
    case "NEGOTIATING":
      return last?.status === "DENIED"
        ? `Denied${last.reason ? `: ${readable(last.reason)}` : ""}${last.field ? ` (${last.field})` : ""}. The agent is working on a fix.`
        : "The agent is negotiating with the PBM.";
    case "SETTLED": return `The PBM conceded. ${usd(view.verdict?.delta)} recovered.`;
    case "EXCEPTION": return "Outside the pharmacist's standing policy. Waiting for a reply.";
    case "ESCALATED": return "Escalated beyond the standard appeal.";
    case "ABANDONED": return `Abandoned${view.reason ? `: ${view.reason}` : ""}.`;
    case "CLEARED": return "Paid at or above cost. No recovery needed.";
    default: return "Waiting for the first stage update.";
  }
}

export type EvidenceItem = { label: string; tone: "good" | "bad" | "muted" };

/** Three-line evidence checklist derived from the evidence packet and denial history. */
export function evidenceItems(view: ClaimView): EvidenceItem[] {
  const ev = view.evidence;
  const have = (ok: boolean): "good" | "muted" => (ok ? "good" : "muted");
  const mark = (ok: boolean) => (ok ? "✓" : "…");
  const invoice = (ev?.attachments.length ?? 0) > 0;
  const statute = Boolean(ev?.statute);
  const items: EvidenceItem[] = [
    { label: `${mark(invoice)} Invoice attached`, tone: have(invoice) },
    { label: `${mark(statute)} Statute cited`, tone: have(statute) },
  ];
  const denial = [...view.decisions].reverse().find((d) => d.status === "DENIED");
  const refiled = view.actions.some((a) => a.kind === "REFILED");
  if (denial && !refiled) {
    items.push({ label: `✗ Missing ${denial.field ? readable(denial.field) : "required field"}`, tone: "bad" });
  } else if (denial && refiled) {
    items.push({ label: `✓ ${denial.field ? readable(denial.field) : "Missing field"} supplied`, tone: "good" });
  } else {
    const complete = (ev?.completeness ?? 0) >= 1;
    items.push({ label: `${mark(complete)} Matches the PBM checklist`, tone: have(complete) });
  }
  return items;
}

export type QueueStatus = { label: string; tone: Tone };

/** Row status on the cashier queue for one submitted prescription. */
export function queueStatus(args: {
  submitting: boolean;
  submitted: boolean;
  rejected: boolean;
  view?: ClaimView;
}): QueueStatus {
  const { submitting, submitted, rejected, view } = args;
  if (submitting) return { label: "SENDING", tone: "info" };
  if (!submitted) return { label: "QUEUED", tone: "muted" };
  if (rejected) return { label: "REJECTED", tone: "bad" };
  if (view?.stage === "SETTLED") return { label: "RESOLVED", tone: "good" };
  if (view?.stage === "CLEARED") return { label: "PAID OK", tone: "good" };
  if (view?.stage === "EXCEPTION") return { label: "NEEDS YOU", tone: "bad" };
  if (view?.stage) return { label: "RECOVERING", tone: "warn" };
  if (view?.verdict && view.verdict.verdict !== "CLEAR") return { label: "UNDERPAID", tone: "bad" };
  return { label: "PAID", tone: "muted" };
}
