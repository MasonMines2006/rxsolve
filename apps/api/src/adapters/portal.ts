/**
 * PortalAdapter (AGT-03). Owner: P2.
 * Playwright fills the PBM Sim portal form from a fixed field map and uploads the PDF; reads the
 * status page / message center. Keep a scripted fallback (BUILD_PLAN kill-switch).
 * Call transcript.record(...) on every submit/poll/reply so the channel viewer shows the exchange.
 */
import type { Claim, Decision, Evidence, Reply, Ticket } from "@rxsolve/contracts";
import type { ChannelAdapter } from "./index";

export class PortalAdapter implements ChannelAdapter {
  channel = "portal" as const;
  async submit(_claim: Claim, _ev: Evidence): Promise<Ticket> { throw new Error("TODO(AGT-03)"); }
  async poll(_ticket: Ticket): Promise<Decision | null> { throw new Error("TODO(AGT-03)"); }
  async reply(_ticket: Ticket, _msg: Reply): Promise<Ticket> { throw new Error("TODO(AGT-03)"); }
}
