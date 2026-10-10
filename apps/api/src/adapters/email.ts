/**
 * EmailAdapter (AGT-04). Owner: P2.
 * Compose the appeal with the PDF attached, send to the PBM Sim inbox, parse the templated reply.
 * Call transcript.record(...) on every submit/poll/reply so the channel viewer shows the exchange.
 */
import type { Claim, Decision, Evidence, Reply, Ticket } from "@rxsolve/contracts";
import type { ChannelAdapter } from "./index";

export class EmailAdapter implements ChannelAdapter {
  channel = "email" as const;
  async submit(_claim: Claim, _ev: Evidence): Promise<Ticket> { throw new Error("TODO(AGT-04)"); }
  async poll(_ticket: Ticket): Promise<Decision | null> { throw new Error("TODO(AGT-04)"); }
  async reply(_ticket: Ticket, _msg: Reply): Promise<Ticket> { throw new Error("TODO(AGT-04)"); }
}
