"use client";
/** Channel viewer (UI-04). Owner: P3. TODO(UI-04): per-claim view; render portal fill, email, fax PDF, WhatsApp. */
import type { PanelProps } from "./types";

export function ChannelViewer({ live }: PanelProps) {
  return (
    <div className="panel">
      <h2>Channel viewer</h2>
      <ul className="plain">
        {live.messages.map((m, i) => (
          <li key={i}>
            <span className="pill">{m.channel}</span> {m.direction === "out" ? "→" : "←"} {m.counterparty}
            {m.claim_id && <span className="muted"> · {m.claim_id}</span>}: {m.text}
          </li>
        ))}
        {live.messages.length === 0 && <li className="muted">No channel traffic yet.</li>}
      </ul>
    </div>
  );
}
