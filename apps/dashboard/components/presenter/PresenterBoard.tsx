"use client";
/** Presenter's second-device page: release held PBM responses and type wholesaler replies. Not linked anywhere. */
import { useMemo, useState } from "react";
import { buildClaimRows, prettyPbm, relativeTime } from "@/lib/claimRows";
import { callRelease, type CallResult, type HoldControl, holdControl, RELEASE_ALL_URL, sendWholesalerReply } from "@/lib/holds";
import { useLive } from "@/lib/live";
import { deriveTree } from "@/lib/tree";

type Phase = { s: "idle" } | { s: "pending" } | ({ s: "done" } & CallResult);

function Feedback({ phase }: { phase: Phase }) {
  return (
    <p className={`presenter__msg${phase.s === "done" && !phase.ok ? " presenter__msg--bad" : ""}`} role="status" aria-live="polite">
      {phase.s === "pending" ? "Sending..." : phase.s === "done" ? phase.detail : ""}
    </p>
  );
}

function usePhase() {
  const [phase, setPhase] = useState<Phase>({ s: "idle" });
  const run = async (call: () => Promise<CallResult>) => {
    setPhase({ s: "pending" });
    setPhase({ s: "done", ...(await call()) });
  };
  return { phase, run, pending: phase.s === "pending" };
}

function ReleaseOne({ control }: { control: Extract<HoldControl, { kind: "pbm" }> }) {
  const { phase, run, pending } = usePhase();
  return (
    <>
      <div className="presenter__row">
        <button type="button" className="presenter__btn" disabled={pending} onClick={() => run(() => callRelease(control.url))}>Release</button>
        <span className="presenter__sub">Waiting on the PBM</span>
      </div>
      <Feedback phase={phase} />
    </>
  );
}

function Reply({ control }: { control: Extract<HoldControl, { kind: "wholesaler" }> }) {
  const [text, setText] = useState(control.defaultText);
  const { phase, run, pending } = usePhase();
  return (
    <form onSubmit={(e) => { e.preventDefault(); void run(() => sendWholesalerReply(text, control.channel)); }}>
      <div className="presenter__row">
        <label className="presenter__sub" htmlFor={`reply-${control.field}`}>Wholesaler reply</label>
        <input id={`reply-${control.field}`} className="presenter__input" value={text} onChange={(e) => setText(e.target.value)} />
        <button type="submit" className="presenter__btn" disabled={pending || text.trim() === ""}>Send reply</button>
      </div>
      <Feedback phase={phase} />
    </form>
  );
}

export function PresenterBoard() {
  const live = useLive();
  const all = usePhase();
  const now = Date.now();
  const rows = useMemo(() => buildClaimRows(live), [live]);
  const waiting = useMemo(() => {
    const t = Date.now();
    return rows.flatMap((r) => {
      const view = live.claims[r.claimId];
      if (!view) return [];
      const model = deriveTree(view, live.messages, live.log, t);
      const control = holdControl(model, view, model.wholesaler);
      return control ? [{ row: r, control }] : [];
    });
  }, [rows, live]);

  return (
    <main className="presenter" aria-label="Presenter">
      <div className="presenter__top">
        <h1>Presenter</h1>
        <div className="presenter__row">
          <button type="button" className="presenter__btn" disabled={all.pending} onClick={() => all.run(() => callRelease(RELEASE_ALL_URL))}>Release all</button>
        </div>
      </div>
      <p className="presenter__note">{live.connected ? "Live feed connected." : "Connecting to the live feed..."} Only claims waiting on the PBM or the wholesaler are listed.</p>
      <Feedback phase={all.phase} />
      {waiting.length === 0 && <p className="presenter__note" role="status">Nothing is waiting right now.</p>}
      {waiting.map(({ row, control }) => (
        <section key={row.claimId} className="presenter__card" aria-label={`${row.drug}, ${row.claimId}`}>
          <p className="presenter__who">{row.drug}</p>
          <p className="presenter__sub">
            qty {row.qty ?? "?"} · {row.pbm ? prettyPbm(row.pbm) : "PBM"} · {relativeTime(row.at, now) || "just now"} · {row.claimId}
          </p>
          {control.kind === "pbm" ? <ReleaseOne control={control} /> : <Reply control={control} />}
        </section>
      ))}
    </main>
  );
}
