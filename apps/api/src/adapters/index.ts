/**
 * Channel adapters (DESIGN.md 7.3). Owner: P2.
 * Every PBM door sits behind one interface; the orchestrator never knows which door it is.
 *   ADAPTER_MODE=direct -> every PBM goes through the PBM Sim's JSON dev door (works from hour one)
 *   ADAPTER_MODE=real   -> portal / email / fax adapters as they land
 */
import type { Claim, Decision, Evidence, Reply, Ticket, Channel } from "@rxsolve/contracts";
import { config } from "../config";
import { spec } from "../reference";
import { DirectAdapter } from "./direct";
import { EmailAdapter } from "./email";
import { FaxAdapter } from "./fax";
import { PortalAdapter } from "./portal";

export interface ChannelAdapter {
  channel: Channel;
  submit(claim: Claim, ev: Evidence): Promise<Ticket>;
  poll(ticket: Ticket): Promise<Decision | null>; // null = still pending
  reply(ticket: Ticket, msg: Reply): Promise<Ticket>; // refile or rebut
}

export function adapterFor(pbm: string): ChannelAdapter {
  const channel = spec(pbm).channel;
  if (config.adapterMode === "real") {
    if (channel === "portal") return new PortalAdapter();
    if (channel === "email") return new EmailAdapter();
    if (channel === "fax") return new FaxAdapter();
  }
  return new DirectAdapter(channel);
}
