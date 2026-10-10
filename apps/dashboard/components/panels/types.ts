import type { LiveState } from "@/lib/state";

export type PanelProps = { live: LiveState & { connected: boolean } };
export const usd = (n: number | null | undefined) => (n == null ? "—" : `$${n.toFixed(2)}`);
