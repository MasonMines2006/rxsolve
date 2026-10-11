"use client";
/** Selected claim's whole journey: stage track, numbers, evidence, status and its channel exchange. */
import { useEffect, useRef, useState } from "react";
import { Panel } from "@/components/ui/Panel";
import { doorWord, evidenceItems, journeySteps, statusSentence } from "@/lib/claims";
import { deadlineLabel, deadlineUrgent, useDeadlineClock } from "@/lib/deadline";
import { type PanelProps, usd } from "./types";

const readable = (v: string) => v.replaceAll("_", " ").toUpperCase();
const clock = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
};

export function ClaimJourney({ live, selectedId }: PanelProps & { selectedId: string | null }) {
  const now = useDeadlineClock();
  const [detailsOpen, setDetailsOpen] = useState(false);
  const transcript = useRef<HTMLUListElement>(null);
  const view = selectedId ? live.claims[selectedId] : undefined;
  const messages = selectedId ? live.messages.filter((m) => m.claim_id === selectedId) : [];

  useEffect(() => {
    const el = transcript.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length, selectedId]);

  useEffect(() => setDetailsOpen(false), [selectedId]);

  if (!selectedId || !view) {
    return (
      <Panel id="journey" title="Claim journey" className="journey">
        <p className="empty">Select a claim to see its whole journey.</p>
      </Panel>
    );
  }

  const { claim } = view;
  const settled = view.stage === "SETTLED";
  const deadline = view.verdict?.appeal_deadline;
  const working = view.stage === "FILED" || view.stage === "NEGOTIATING";
  const rawFields: [string, string][] = [
    ["Claim", claim.claim_id],
    ["Transaction", claim.ncpdp?.transaction ?? "—"],
    ...Object.entries(claim.ncpdp?.request ?? {}).map(([k, v]) => [`Request ${k}`, String(v)] as [string, string]),
    ...Object.entries(claim.ncpdp?.response ?? {}).map(([k, v]) => [`Response ${k}`, String(v)] as [string, string]),
    ["State", claim.state],
    ["Spec version", view.evidence?.spec_version ?? "—"],
  ];

  return (
    <Panel
      id="journey"
      title={view.claim.drug || "Claim journey"}
      aside={<button type="button" className="btn btn--ghost btn--sm" aria-expanded={detailsOpen} onClick={() => setDetailsOpen((o) => !o)}>Details</button>}
      className="journey"
    >
      <p className="journey__meta">
        <span className="mono">{claim.claim_id}</span> · {claim.pbm} · via {view.ticket?.channel ?? "not yet filed"}
      </p>

      <ol className="track" aria-label="Claim stages">
        {journeySteps(view).map((s) => (
          <li key={s.stage} className={`track__step track__step--${s.state}`} aria-current={s.state === "now" ? "step" : undefined}>
            {s.stage}
          </li>
        ))}
      </ol>

      <div className="stats">
        <div className="stat">
          <small>Underpaid</small>
          <span className="stat__num money">{usd(view.verdict?.delta)}</span>
          <span>Paid {usd(claim.paid_amount)} · drug cost {usd(claim.acquisition_cost)}</span>
        </div>
        <div className="stat">
          <small>Appeal deadline</small>
          <span className={`stat__num stat__num--time mono ${!settled && deadlineUrgent(deadline, now) ? "tone-bad" : ""}`}>
            {settled ? "Satisfied" : deadlineLabel(deadline, now).split(" · ")[0]}
          </span>
          <span>{claim.state} statute window{deadline ? ` · ${deadline}` : ""}</span>
        </div>
        <div className="stat">
          <small>Evidence</small>
          <ul className="evidence">
            {evidenceItems(view).map((e) => <li key={e.label} className={`tone-${e.tone}`}>{e.label}</li>)}
          </ul>
        </div>
      </div>

      <p className={`journey__status ${settled ? "tone-good" : view.stage === "EXCEPTION" ? "tone-bad" : ""}`}>
        {statusSentence(view, usd)}
      </p>
      {working && (
        <div className="agent-banner">
          <span className="agent-banner__dot" aria-hidden="true" />
          Agent is working the {claim.pbm} {doorWord(view.ticket?.channel)} by itself. No human is touching it.
        </div>
      )}

      <ul className="transcript" ref={transcript} aria-label="Channel exchange for this claim" aria-live="polite" aria-relevant="additions">
        {messages.length === 0 && <li className="empty">No channel traffic for this claim yet.</li>}
        {messages.map((m, i) => (
          <li key={`${m.ts}-${i}`} className={`msg msg--${m.direction}`}>
            <div className="msg__head">
              <span className="chan">{m.channel.toUpperCase()}</span>
              <span>{m.direction === "out" ? "SENT" : "RECEIVED"} · {readable(m.counterparty)}</span>
              <span className="mono msg__time">{clock(m.ts)}</span>
            </div>
            <div className="msg__text">{m.text}</div>
            {m.attachments.map((a) => <span key={a} className="attachment">{a}</span>)}
          </li>
        ))}
      </ul>

      {detailsOpen && (
        <aside className="drawer" aria-label="Claim details">
          <h3>Details · raw fields</h3>
          <dl>
            {rawFields.map(([k, v], i) => (
              <div className="drawer__row" key={`${k}-${i}`}><dt>{k}</dt><dd className="mono">{v}</dd></div>
            ))}
          </dl>
          <button type="button" className="btn btn--ghost btn--sm" onClick={() => setDetailsOpen(false)}>Close</button>
        </aside>
      )}
    </Panel>
  );
}
