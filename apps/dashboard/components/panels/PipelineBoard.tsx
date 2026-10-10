"use client";
/** Pipeline board (UI-03). Owner: P3. TODO(UI-03): per-card deadline clock, channel, PBM. */
import type { Stage } from "@rxsolve/contracts";
import { type PanelProps, usd } from "./types";

const COLUMNS: Stage[] = ["DETECTED", "EVIDENCE", "FILED", "NEGOTIATING", "SETTLED", "ESCALATED", "ABANDONED", "EXCEPTION"];

export function PipelineBoard({ live }: PanelProps) {
  return (
    <div className="panel">
      <h2>Pipeline</h2>
      <div style={{ display: "grid", gap: 8, gridTemplateColumns: `repeat(${COLUMNS.length}, minmax(110px, 1fr))`, overflowX: "auto" }}>
        {COLUMNS.map((col) => (
          <div key={col}>
            <div className="muted" style={{ fontSize: 12, marginBottom: 6 }}>{col}</div>
            <ul className="plain">
              {live.order.filter((id) => live.claims[id]?.stage === col).map((id) => (
                <li key={id} className="pill">{id} <span className="money">{usd(live.claims[id]!.verdict?.delta)}</span></li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}
