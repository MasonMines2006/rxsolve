"use client";
/** Pharmacist phone mock (UI-04). Mirrors the iMessage thread and local reply controls. */
import { useState } from "react";

import type { PanelProps } from "./types";

type PhoneAction = "digest" | "reply";
type Feedback = { kind: "success" | "error"; text: string };
type PhoneMessage = { claim_id: string | null; text: string };

function formatTimestamp(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "Unknown time"
    : new Intl.DateTimeFormat(undefined, { dateStyle: "short", timeStyle: "short" }).format(date);
}

function messageKind(message: PhoneMessage) {
  if (message.claim_id || /^RxSolve:/i.test(message.text)) return "Exception";
  if (/^RxSolve\b/i.test(message.text)) return "Daily digest";
  return null;
}

export function PharmacistPhone({ live }: PanelProps) {
  const [text, setText] = useState("");
  const [pending, setPending] = useState<PhoneAction | null>(null);
  const [feedback, setFeedback] = useState<Feedback | null>(null);

  const runAction = async (action: PhoneAction) => {
    if (pending) return;
    const replyText = text.trim();
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
      if (action === "reply") setText("");
      setFeedback({
        kind: "success",
        text: action === "digest" ? "Digest sent to the phone thread." : "Reply sent. RxSolve's response will appear in the thread.",
      });
    } catch (error) {
      setFeedback({
        kind: "error",
        text: error instanceof Error ? error.message : "The request failed. Please try again.",
      });
    } finally {
      setPending(null);
    }
  };

  return (
    <section className="panel pharmacist-phone" aria-labelledby="pharmacist-phone-title">
      <header className="pharmacist-phone__header" style={{ display: "flex", justifyContent: "space-between", alignItems: "start", flexWrap: "wrap", gap: 12 }}>
        <div>
          <h2 id="pharmacist-phone-title">Pharmacist phone</h2>
          <p className="muted pharmacist-phone__description" style={{ margin: "-4px 0 12px" }}>Digest, claim exceptions, and pharmacist replies</p>
        </div>
        <button className="pharmacist-phone__digest-button" type="button" onClick={() => void runAction("digest")} disabled={pending !== null}>
          {pending === "digest" ? "Sending digest…" : "Send today's digest"}
        </button>
      </header>

      <div className="pharmacist-phone__device" style={{ width: "100%", maxWidth: 380, marginInline: "auto", padding: 9, background: "var(--surface-2)", border: "1px solid var(--border-strong)", borderRadius: "var(--radius)", boxShadow: "var(--shadow-raised)" }}>
        <div className="pharmacist-phone__screen" style={{ overflow: "hidden", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)" }}>
          <div className="pharmacist-phone__status-bar muted" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, padding: "8px 12px", borderBottom: "1px solid var(--border)", fontSize: 12 }}>
            <span>RxSolve secure line</span>
            <span>iMessage</span>
          </div>
          <div className="pharmacist-phone__contact" style={{ display: "grid", justifyItems: "center", gap: 3, padding: "12px 10px", borderBottom: "1px solid var(--border)" }}>
            <span className="pill" aria-hidden="true">Rx</span>
            <strong>RxSolve</strong>
            <span className="muted" style={{ fontSize: 12 }}>Pharmacy operations</span>
          </div>

          <ol className="plain pharmacist-phone__thread" aria-label="Pharmacist iMessage conversation" aria-live="polite" aria-relevant="additions" style={{ display: "grid", alignContent: "start", gap: 12, minHeight: 210, maxHeight: "min(48vh, 440px)", overflowY: "auto", padding: 12 }}>
            {live.phone.map((message, index) => {
              const kind = messageKind(message);
              const isRxSolve = message.direction === "out";
              return (
                <li className={`pharmacist-phone__message pharmacist-phone__message--${isRxSolve ? "rxsolve" : "pharmacist"}`} key={`${message.ts}-${message.counterparty}-${index}`} style={{ display: "flex", justifyContent: isRxSolve ? "flex-start" : "flex-end" }}>
                  <article className="pharmacist-phone__bubble" style={{ display: "grid", gap: 6, width: "fit-content", maxWidth: "92%", padding: 10, background: isRxSolve ? "var(--surface-2)" : "var(--inset-surface)", border: "1px solid var(--border)", borderRadius: "var(--radius)" }}>
                    <div className="pharmacist-phone__message-meta" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 6 }}>
                      <span className="muted pharmacist-phone__sender">{isRxSolve ? "RxSolve" : "You"}</span>
                      {kind && <span className="pill pharmacist-phone__message-kind">{kind}</span>}
                    </div>
                    <p className="pharmacist-phone__message-text" style={{ margin: 0, whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{message.text || "(No message text)"}</p>
                    {message.attachments.length > 0 && (
                      <ul className="plain pharmacist-phone__attachments" style={{ display: "flex", flexWrap: "wrap", gap: 5 }} aria-label="Message attachments">
                        {message.attachments.map((attachment: string, attachmentIndex: number) => <li className="pill" key={`${attachment}-${attachmentIndex}`}>{attachment}</li>)}
                      </ul>
                    )}
                    {message.audio_url && (
                      <audio className="pharmacist-phone__audio" controls preload="none" src={message.audio_url} aria-label={`${kind ?? "Message"} audio recap`} style={{ display: "block", width: "100%", maxWidth: 280 }}>
                        Your browser does not support audio playback.
                      </audio>
                    )}
                    <time className="muted pharmacist-phone__timestamp" dateTime={message.ts} title={message.ts} style={{ fontSize: 11 }}>{formatTimestamp(message.ts)}</time>
                  </article>
                </li>
              );
            })}
            {live.phone.length === 0 && (
              <li className="muted pharmacist-phone__empty" role="status" style={{ alignSelf: "center", padding: "28px 8px", textAlign: "center" }}>
                No messages yet. Send a digest or run a claim that needs pharmacist attention.
              </li>
            )}
          </ol>
          <form className="pharmacist-phone__composer" onSubmit={(event) => { event.preventDefault(); void runAction("reply"); }} style={{ display: "grid", gap: 6, padding: 10, borderTop: "1px solid var(--border)" }}>
            <label className="muted" htmlFor="pharmacist-phone-reply" style={{ fontSize: 12 }}>Reply as pharmacist</label>
            <div className="pharmacist-phone__composer-controls" style={{ display: "flex", alignItems: "stretch", gap: 6 }}>
              <input
                id="pharmacist-phone-reply"
                className="pharmacist-phone__reply-input"
                value={text}
                onChange={(event) => setText(event.target.value)}
                placeholder="APPROVE RXS-0001, DETAILS, PAUSE…"
                autoComplete="off"
                maxLength={2000}
                disabled={pending === "reply"}
                style={{ minWidth: 0, flex: 1, padding: "7px 10px" }}
              />
              <button className="pharmacist-phone__reply-button" type="submit" disabled={pending !== null || !text.trim()}>
                {pending === "reply" ? "Sending…" : "Send"}
              </button>
            </div>
          </form>
        </div>
      </div>

      {feedback && (
        <p className={`pharmacist-phone__feedback pharmacist-phone__feedback--${feedback.kind}`} role={feedback.kind === "error" ? "alert" : "status"} aria-live="polite" style={{ marginBottom: 0 }}>
          {feedback.text}
        </p>
      )}
    </section>
  );
}
