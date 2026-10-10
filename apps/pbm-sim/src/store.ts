/** PBM Sim's own datastore (in-memory; it never touches the agents' database). */
import type { Decision } from "./engine";

export type Appeal = {
  ticket_id: string; claim_id: string; pbm: string; state: string; channel: string;
  fields: Record<string, unknown>; attachments: string[]; delta: number;
  submitted_at: string; decide_at: number; round: number; decision: Decision | null;
  history: { round: number; decision: Decision | null }[];
};

export const claims: Record<string, unknown>[] = []; // adjudicated switch transactions
export const appeals = new Map<string, Appeal>();
let seq = 48213;
export const nextTicket = (prefix: string) => `${prefix}-${seq++}`;
