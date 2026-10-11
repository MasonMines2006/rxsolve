/** PBM Sim's own datastore (in-memory; it never touches the agents' database). */
import type { Decision } from "./engine";

export type Appeal = {
  ticket_id: string; claim_id: string; pbm: string; state: string; channel: string;
  fields: Record<string, unknown>; attachments: string[]; delta: number;
  submitted_at: string; decide_at: number; round: number; decision: Decision | null;
  /** Demo hold mode: the decision stays pending until released or `hold_until` passes. */
  held: boolean; hold_until: number;
  history: { round: number; decision: Decision | null }[];
};

export const claims: Record<string, unknown>[] = []; // adjudicated switch transactions
export const appeals = new Map<string, Appeal>();
// Ticket numbers must never repeat across restarts: the API persists appeals keyed by ticket_id (TigerData),
// so a counter that restarts at a constant collides with the last run. Start from the boot time in seconds.
let seq = Math.floor(Date.now() / 1000);
export const nextTicket = (prefix: string) => `${prefix}-${seq++}`;
