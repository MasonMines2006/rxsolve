import type { ReactNode } from "react";
import type { Tone } from "@/lib/claims";

/** Outlined status badge. Tone picks the color token; `big` is the large response badge. */
export function Pill({ tone = "muted", big = false, children }: { tone?: Tone; big?: boolean; children: ReactNode }) {
  return <span className={`pill pill--${tone}${big ? " pill--big" : ""}`}>{children}</span>;
}
