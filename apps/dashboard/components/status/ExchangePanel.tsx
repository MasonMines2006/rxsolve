"use client";
/** Whole-claim channel transcript with attachment chips that open the artifacts. Owner: P3. */
import type { ChannelMessage } from "@rxsolve/contracts";
import { artifactUrl, classifyArtifact } from "@/lib/artifacts";
import { type Chip, groupExchange } from "@/lib/exchangeSteps";

export function DeliveryChip({ chip }: { chip: Chip | null }) {
  return chip ? <span className={`dchip dchip--${chip.kind}`}>{chip.label}</span> : null;
}

const readable = (v: string) => v.replaceAll("_", " ").toUpperCase();
const clock = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
};

export function ExchangeList({ messages }: { messages: ChannelMessage[] }) {
  const steps = groupExchange(messages);
  return (
    <ul className="plain transcript" aria-label="Channel exchange for this claim">
      {steps.length === 0 && <li className="empty">No channel traffic for this claim yet.</li>}
      {steps.map((st, i) => {
        const m = st.type === "fallback" ? st.second : st.msg;
        return (
          <li key={`${m.ts}-${i}`} className={`msg msg--${m.direction}`}>
            <div className="msg__head">
              <span className="chan">{st.type === "fallback" ? "WHATSAPP, THEN SMS" : m.channel.toUpperCase()}</span>
              <span>{m.direction === "out" ? "SENT" : "RECEIVED"} · {readable(m.counterparty)}</span>
              <DeliveryChip chip={st.chip} />
              <span className="mono msg__time">{clock(m.ts)}</span>
            </div>
            <div className="msg__text">{m.text}</div>
            {st.type === "fallback" && <div className="caption">{st.label}</div>}
            {m.attachments.map((a) => (
              <a key={a} className="attachment" href={artifactUrl(a)} target="_blank" rel="noreferrer" title={a}>
                {classifyArtifact(a).label}<span className="sr-only"> ({a})</span>
              </a>
            ))}
          </li>
        );
      })}
    </ul>
  );
}
