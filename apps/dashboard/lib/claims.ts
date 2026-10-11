/** Pure view helpers over ClaimView for the claim list, status screen and cashier panels. */
import type { Stage } from "@rxsolve/contracts";
import { plainField, plainReason } from "./plain";
import type { LiveState, ClaimView } from "./state";

export type Tone = "good" | "bad" | "warn" | "info" | "muted";

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

const DOOR: Record<string, string> = { portal: "web portal", email: "inbox", fax: "fax line", phone: "phone line" };
export const doorWord = (channel: string | undefined) => (channel && DOOR[channel]) || "channel";

const readable = (s: string) => s.replaceAll("_", " ").toLowerCase();

/** One sentence on where the claim is, built only from live fields. */
export function statusSentence(view: ClaimView, usd: (n: number | null | undefined) => string): string {
  const door = doorWord(view.ticket?.channel);
  const last = view.decisions.at(-1);
  switch (view.stage) {
    case "DETECTED": return "Found at the register: the PBM paid less than the drug cost.";
    case "EVIDENCE": return "Building proof from the pharmacy invoice and the state law.";
    case "FILED": return `Appeal filed through the PBM's ${door}. Waiting for its decision.`;
    case "NEGOTIATING":
      return last?.status === "DENIED"
        ? `Denied${last.reason ? `: ${plainReason(last.reason)}` : ""}${last.field ? ` (${plainField(last.field)})` : ""}. The agent is working on a fix.`
        : "The agent is negotiating with the PBM.";
    case "SETTLED": return `The PBM paid up. ${usd(view.verdict?.delta)} recovered.`;
    case "EXCEPTION": return "Outside the pharmacist's standing rules. Waiting for a reply.";
    case "ESCALATED": return "Escalated beyond the standard appeal.";
    case "ABANDONED": return `Given up${view.reason ? `: ${view.reason}` : ""}.`;
    case "CLEARED": return "Paid fairly. No recovery needed.";
    default: return "Waiting for the first stage update.";
  }
}
