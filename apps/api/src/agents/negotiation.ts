/**
 * Negotiation (AGT-06). Owner: P2.
 * Called by the orchestrator only on a denial. Today: rule-based diagnosis. To do: have the agent
 * model read the PBM's raw denial (portal message, email body, fax scan) into reason/field first.
 */
import type { Action, Claim, Decision, Evidence, Ticket } from "@rxsolve/contracts";
import type { ChannelAdapter } from "../adapters";
import { withDocument } from "./evidence";
import { requestDocument } from "./wholesaler";

export async function onDenial(claim: Claim, ev: Evidence, denial: Decision, adapter: ChannelAdapter, ticket: Ticket): Promise<Action> {
  if (denial.reason === "missing_field" && denial.field) {
    const doc = await requestDocument(claim, denial.field);
    const evidence = withDocument(ev, claim.pbm, denial.field, doc);
    const next = await adapter.reply(ticket, { evidence, note: `Refiled with ${denial.field.replaceAll("_", " ")}` });
    return { kind: "REFILED", ticket: next, evidence };
  }
  if (denial.reason === "disputed" && ev.completeness >= 1) {
    // TODO(INF-06/AGT-08): rebut citing ev.statute; call the rep if the persona has one.
    return { kind: "ESCALATED", reason: "disputed with complete evidence" };
  }
  if (denial.reason === "window_expired") {
    // TODO: file the external appeal with the state regulator.
    return { kind: "EXTERNAL_APPEAL", reason: "appeal window expired" };
  }
  return { kind: "ABANDONED", reason: denial.reason ?? "unknown denial" };
}
