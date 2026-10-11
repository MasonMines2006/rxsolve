"use client";
/** Channel viewer (UI-04). Renders the live exchange across PBM and wholesaler channels. */
import { useState } from "react";
import type { PanelProps } from "./types";

const readable = (value: string) => value
  .replaceAll("_", " ")
  .toLowerCase()
  .replace(/\b\w/g, (letter) => letter.toUpperCase())
  .replace(/\bPbm\b/g, "PBM");

const readableChannel = (value: string) => value.toLowerCase() === "imessage"
  ? "iMessage"
  : readable(value);

function formatTimestamp(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "Unknown time"
    : new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date);
}

export function ChannelViewer({ live }: PanelProps) {
  const [claimFilter, setClaimFilter] = useState("all");
  const [channelFilter, setChannelFilter] = useState("all");
  const claims = [...new Set(live.messages.map((message) => message.claim_id))];
  const channels = [...new Set(live.messages.map((message) => message.channel))].sort();
  const messages = live.messages
    .map((message, index) => ({ message, index }))
    .filter(({ message }) => {
      const matchesClaim = claimFilter === "all"
        || (claimFilter === "unassigned" ? message.claim_id === null : message.claim_id === claimFilter);
      return matchesClaim && (channelFilter === "all" || message.channel === channelFilter);
    })
    .sort((a, b) => {
      const timeDifference = Date.parse(a.message.ts) - Date.parse(b.message.ts);
      return Number.isNaN(timeDifference) || timeDifference === 0 ? a.index - b.index : timeDifference;
    });

  return (
    <section className="panel channel-viewer" aria-labelledby="channel-viewer-title">
      <header className="channel-viewer__header" style={{ display: "flex", justifyContent: "space-between", alignItems: "start", flexWrap: "wrap", gap: 12 }}>
        <div>
          <h2 id="channel-viewer-title">Channel viewer</h2>
          <span className="muted" aria-live="polite">{messages.length} {messages.length === 1 ? "message" : "messages"}</span>
        </div>
        <span className={live.connected ? "pill channel-viewer__connection" : "pill channel-viewer__connection channel-viewer__connection--offline"} role="status">
          {live.connected ? "Live feed connected" : "Live feed disconnected"}
        </span>
      </header>

      <div className="channel-viewer__filters" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 180px), 1fr))", gap: 10, margin: "14px 0" }}>
        <label className="channel-viewer__filter" style={{ display: "grid", gap: 4 }}>
          <span className="muted">Claim</span>
          <select aria-label="Filter by claim" value={claimFilter} onChange={(event) => setClaimFilter(event.target.value)}>
            <option value="all">All claims</option>
            {claims.includes(null) && <option value="unassigned">Unassigned messages</option>}
            {claims.filter((claimId): claimId is string => claimId !== null).sort().map((claimId) => (
              <option key={claimId} value={claimId}>{claimId}</option>
            ))}
          </select>
        </label>
        <label className="channel-viewer__filter" style={{ display: "grid", gap: 4 }}>
          <span className="muted">Channel</span>
          <select aria-label="Filter by channel" value={channelFilter} onChange={(event) => setChannelFilter(event.target.value)}>
            <option value="all">All channels</option>
            {channels.map((channel) => <option key={channel} value={channel}>{readableChannel(channel)}</option>)}
          </select>
        </label>
      </div>

      <ol className="plain channel-viewer__transcript" aria-label="Channel transcript" aria-live="polite" aria-relevant="additions" style={{ maxHeight: "min(58vh, 620px)", overflowY: "auto", gap: 10 }}>
        {messages.map(({ message, index }) => {
          const sender = message.direction === "out" ? "RxSolve" : readable(message.counterparty);
          const recipient = message.direction === "out" ? readable(message.counterparty) : "RxSolve";
          const metadata = Object.entries(message.meta);
          return (
            <li className={`channel-viewer__message channel-viewer__message--${message.direction}`} key={`${message.ts}-${message.channel}-${index}`}>
              <article className="channel-viewer__message-card" style={{ display: "grid", gap: 8, padding: 12, background: "var(--surface-2)", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)" }}>
                <header className="channel-viewer__message-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
                  <div className="channel-viewer__message-routing" style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 6 }}>
                    <span className="pill">{readableChannel(message.channel)}</span>
                    <span className="channel-viewer__direction">{sender} <span aria-hidden="true">→</span> {recipient}</span>
                  </div>
                  <time className="muted channel-viewer__timestamp" dateTime={message.ts} title={message.ts}>{formatTimestamp(message.ts)}</time>
                </header>
                <div className="channel-viewer__message-context muted" style={{ display: "flex", flexWrap: "wrap", gap: 8, fontSize: 12 }}>
                  <span>Counterparty: {readable(message.counterparty)}</span>
                  <span>Claim: {message.claim_id ?? "Unassigned"}</span>
                </div>
                <p className="channel-viewer__message-text" style={{ margin: 0, whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{message.text || "(No message text)"}</p>
                {message.audio_url && (
                  <audio className="channel-viewer__audio" controls preload="none" src={message.audio_url} aria-label={`${readableChannel(message.channel)} message audio`} style={{ display: "block", width: "100%", maxWidth: 360 }}>
                    Your browser does not support audio playback.
                  </audio>
                )}
                {message.attachments.length > 0 && (
                  <div className="channel-viewer__attachments">
                    <span className="muted">Attachments</span>
                    <ul className="plain channel-viewer__attachment-list" style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 4 }}>
                      {message.attachments.map((attachment: string, attachmentIndex: number) => (
                        <li className="pill" key={`${attachment}-${attachmentIndex}`}>{attachment}</li>
                      ))}
                    </ul>
                  </div>
                )}
                {metadata.length > 0 && (
                  <details className="channel-viewer__metadata">
                    <summary>Message metadata ({metadata.length})</summary>
                    <pre className="channel-viewer__metadata-content" style={{ maxHeight: 240, overflow: "auto", whiteSpace: "pre-wrap", overflowWrap: "anywhere", padding: 10, background: "var(--inset-surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)" }}>
                      {JSON.stringify(message.meta, null, 2)}
                    </pre>
                  </details>
                )}
              </article>
            </li>
          );
        })}
        {live.messages.length === 0 && (
          <li className="muted channel-viewer__empty" role="status">No channel traffic yet. Messages will appear here as claims move through the PBM and wholesaler channels.</li>
        )}
        {live.messages.length > 0 && messages.length === 0 && (
          <li className="muted channel-viewer__empty" role="status">No messages match these filters. Choose another claim or channel.</li>
        )}
      </ol>
    </section>
  );
}
