"use client";
/**
 * Pharmacist phone mock (UI-04). Owner: P3. Mirrors the iMessage thread; also the kill-switch when
 * Spectrum is down. Replies go to /api/dev/pharmacist-reply. TODO(UI-04): phone frame, voice recap player.
 */
import { useState } from "react";
import type { PanelProps } from "./types";

export function PharmacistPhone({ live }: PanelProps) {
  const [text, setText] = useState("");
  const reply = async () => {
    if (!text.trim()) return;
    await fetch("/api/dev/pharmacist-reply", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text }) });
    setText("");
  };
  return (
    <div className="panel">
      <h2>Pharmacist phone</h2>
      <button onClick={() => fetch("/api/digest", { method: "POST" })}>Send today's digest</button>
      <ul className="plain" style={{ margin: "8px 0" }}>
        {live.phone.map((m, i) => (
          <li key={i} style={{ textAlign: m.direction === "out" ? "left" : "right" }}>
            <span className="pill">{m.text}</span>
            {m.audio_url && <audio controls src={m.audio_url} style={{ display: "block", marginTop: 4 }} />}
          </li>
        ))}
      </ul>
      <input value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === "Enter" && reply()} placeholder="Reply as pharmacist" />
    </div>
  );
}
