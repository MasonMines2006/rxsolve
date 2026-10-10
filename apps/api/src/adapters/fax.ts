/**
 * FaxAdapter (AGT-05). Owner: P2.
 * Render cover sheet + evidence PDF, POST to the fax line, read the scanned-look reply PDF with
 * vision/OCR (kill-switch: text-layer PDF).
 * Call transcript.record(...) on every submit/poll/reply so the channel viewer shows the exchange.
 */
import type { Claim, Decision, Evidence, Reply, Ticket } from "@rxsolve/contracts";
import type { ChannelAdapter } from "./index";

export class FaxAdapter implements ChannelAdapter {
  channel = "fax" as const;
  async submit(_claim: Claim, _ev: Evidence): Promise<Ticket> { throw new Error("TODO(AGT-05)"); }
  async poll(_ticket: Ticket): Promise<Decision | null> { throw new Error("TODO(AGT-05)"); }
  async reply(_ticket: Ticket, _msg: Reply): Promise<Ticket> { throw new Error("TODO(AGT-05)"); }
}
