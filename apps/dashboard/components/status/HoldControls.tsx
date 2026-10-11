"use client";
/** Presenter controls for outside waits: release a held PBM ticket, or type the wholesaler's reply. Owner: P3. */
import { useState } from "react";
import { callRelease, type CallResult, type HoldControl, RELEASE_ALL_URL, sendWholesalerReply } from "@/lib/holds";

type Phase = { s: "idle" } | { s: "pending" } | ({ s: "done" } & CallResult);

function Feedback({ phase }: { phase: Phase }) {
  return (
    <p className={`hold__msg${phase.s === "done" && !phase.ok ? " tone-bad" : ""}`} role="status" aria-live="polite">
      {phase.s === "pending" ? "Sending..." : phase.s === "done" ? phase.detail : ""}
    </p>
  );
}

export function HoldControls({ control }: { control: HoldControl }) {
  const [phase, setPhase] = useState<Phase>({ s: "idle" });
  const [text, setText] = useState(control.kind === "wholesaler" ? control.defaultText : "");
  const run = async (call: () => Promise<CallResult>) => {
    setPhase({ s: "pending" });
    setPhase({ s: "done", ...(await call()) });
  };
  const pending = phase.s === "pending";

  if (control.kind === "pbm") {
    return (
      <div className="hold">
        <p className="hold__tag">Presenter control</p>
        <button type="button" className="btn btn--ghost btn--sm" disabled={pending} onClick={() => run(() => callRelease(control.url))}>
          Demo control: PBM responds (simulated)
        </button>
        <Feedback phase={phase} />
      </div>
    );
  }
  return (
    <form className="hold" onSubmit={(e) => { e.preventDefault(); void run(() => sendWholesalerReply(text, control.channel)); }}>
      <p className="hold__tag">Presenter control</p>
      <label className="hold__label">
        <span className="caption">Wholesaler reply text</span>
        <input className="hold__input" value={text} onChange={(e) => setText(e.target.value)} />
      </label>
      <button type="submit" className="btn btn--ghost btn--sm" disabled={pending || text.trim() === ""}>
        Demo control: wholesaler replies (simulated)
      </button>
      <Feedback phase={phase} />
    </form>
  );
}

/** Small header control that releases every held PBM ticket. */
export function ReleaseAll() {
  const [phase, setPhase] = useState<Phase>({ s: "idle" });
  const go = async () => {
    setPhase({ s: "pending" });
    setPhase({ s: "done", ...(await callRelease(RELEASE_ALL_URL)) });
  };
  return (
    <div className="release-all">
      <button type="button" className="btn btn--ghost btn--sm release-all__btn" disabled={phase.s === "pending"} onClick={go}>
        Release all PBM holds
      </button>
      <span className={`caption${phase.s === "done" && !phase.ok ? " tone-bad" : ""}`} role="status" aria-live="polite">
        {phase.s === "pending" ? "Releasing..." : phase.s === "done" ? phase.detail : ""}
      </span>
    </div>
  );
}
