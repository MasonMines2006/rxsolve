"use client";
/** Pharmacist phone mock (UI-04). Mirrors the iMessage thread; digest and replies hit the real API. */
import { useEffect, useRef, useState } from "react";
import { Panel } from "@/components/ui/Panel";
import { deliveryState } from "@/lib/delivery";
import type { PanelProps } from "./types";

type Action = "digest" | "reply";
type Feedback = { kind: "success" | "error"; text: string };

const time = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
};

export function PharmacistPhone({ live }: PanelProps) {
  const [text, setText] = useState("");
  const [pending, setPending] = useState<Action | null>(null);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const thread = useRef<HTMLOListElement>(null);

  useEffect(() => {
    const el = thread.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [live.phone.length]);

  const lastOut = [...live.phone].reverse().find((m) => m.direction === "out");
  const headline = lastOut ? `${deliveryState(lastOut.meta).label} · ${time(lastOut.ts)}` : "No messages yet";

  async function run(action: Action, replyText = text.trim()) {
    if (pending) return;
    if (action === "reply" && !replyText) return;
    setPending(action);
    setFeedback(null);
    try {
      const response = await fetch(action === "digest" ? "/api/digest" : "/api/dev/pharmacist-reply", {
        method: "POST",
        ...(action === "reply" && {
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ text: replyText }),
        }),
      });
      if (!response.ok) {
        const detail = await response.text().catch(() => "");
        throw new Error(detail || `Request failed with status ${response.status}.`);
      }
      if (action === "reply") {
        setText("");
        setFeedback({ kind: "success", text: "Reply sent. RxSolve's response will appear in the thread." });
      } else {
        // The digest response is the recorded ChannelMessage; meta.delivered says what Spectrum did.
        const body = await response.json().catch(() => null) as { meta?: Record<string, unknown> } | null;
        const state = deliveryState(body?.meta);
        setFeedback({
          kind: state.kind === "dashboard-only" ? "error" : "success",
          text: state.kind === "delivered" ? "Digest delivered to the phone."
            : state.kind === "dashboard-only" ? "Digest not delivered (dashboard only)."
              : "Digest posted to the simulated phone.",
        });
      }
    } catch (error) {
      setFeedback({ kind: "error", text: error instanceof Error ? error.message : "The request failed. Please try again." });
    } finally {
      setPending(null);
    }
  }

  return (
    <Panel id="phone" title="Pharmacist" aside={headline} className="pharmacist">
      <div className="phone-wrap">
        <div className="phone">
          <div className="phone__head">RxSolve<small>iMessage</small></div>
          <ol className="bubbles plain" ref={thread} aria-label="Pharmacist iMessage conversation" aria-live="polite" aria-relevant="additions">
            {live.phone.map((m, i) => {
              const fromRxSolve = m.direction === "out";
              const state = fromRxSolve ? deliveryState(m.meta) : null;
              return (
                <li key={`${m.ts}-${i}`} className={`bubble bubble--${fromRxSolve ? "in" : "out"}`}>
                  <p>{m.text || "(No message text)"}</p>
                  {m.audio_url && <audio controls preload="none" src={m.audio_url} aria-label="Audio recap" />}
                  <small className={state && state.kind !== "delivered" ? "tone-warn" : undefined}>
                    {[state?.label, time(m.ts)].filter(Boolean).join(" · ")}
                  </small>
                </li>
              );
            })}
            {live.phone.length === 0 && <li className="empty" role="status">No messages yet. Send a digest or run a claim that needs the pharmacist.</li>}
          </ol>
          <form className="reply" onSubmit={(e) => { e.preventDefault(); void run("reply"); }}>
            <label className="sr-only" htmlFor="pharmacist-phone-reply">Reply as pharmacist</label>
            <input
              id="pharmacist-phone-reply"
              className="reply__input"
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="APPROVE, DETAILS, PAUSE…"
              autoComplete="off"
              maxLength={2000}
              disabled={pending === "reply"}
            />
            <button className="btn btn--sm" type="submit" disabled={pending !== null || !text.trim()}>
              {pending === "reply" ? "Sending…" : "Send"}
            </button>
          </form>
        </div>

        <div className="phone-side">
          <button className="btn" type="button" onClick={() => void run("digest")} disabled={pending !== null}>
            {pending === "digest" ? "Sending digest…" : "Send today's digest"}
          </button>
          <button className="btn btn--ghost" type="button" onClick={() => void run("reply", "APPROVE")} disabled={pending !== null}>Approve</button>
          <button className="btn btn--ghost" type="button" onClick={() => void run("reply", "DETAILS")} disabled={pending !== null}>Details</button>
          {feedback && (
            <p className={`feedback feedback--${feedback.kind}`} role={feedback.kind === "error" ? "alert" : "status"}>{feedback.text}</p>
          )}
        </div>
      </div>
    </Panel>
  );
}
