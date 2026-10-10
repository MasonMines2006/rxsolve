"use client";
/**
 * PMS mock / cashier terminal (UI-02, do not cut). Owner: P3.
 * Submits an NCPDP-shaped B1 straight to the PBM Sim switch (proxied at /sim), renders the response,
 * then shows the claim's live badge (RESOLVED ABOVE COST / recovery in flight) from /ws/live.
 * TODO(UI-02): patient queue, line items, pick drugs; real dispensing-screen look.
 */
import { useState } from "react";
import { type PanelProps, usd } from "./types";

const DEMO = {
  transaction: "B1",
  meta: { pbm: "PBM_PORTAL", pharmacy_id: "PH-MEADOWBROOK", state: "TN", plan: "TN Part D", patient_ref: "PT-7F3A" },
  request: { "407-D7": "00378001801", "442-E7": 1000, "405-D5": 30, "409-D9": 14.5, "426-DQ": 18.0 },
};

export function CashierTerminal({ live }: PanelProps) {
  const [resp, setResp] = useState<Record<string, unknown> | null>(null);
  const [claimId, setClaimId] = useState<string | null>(null);

  async function submit() {
    const rx = String(Math.floor(1_000_000 + Math.random() * 8_999_999));
    const id = `RXS-${rx}`;
    const r = await fetch("/sim/switch/claim", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...DEMO, meta: { ...DEMO.meta, claim_id: id }, request: { ...DEMO.request, "402-D2": rx } }),
    });
    setResp(((await r.json()) as { response: Record<string, unknown> }).response);
    setClaimId(id);
  }

  const view = claimId ? live.claims[claimId] : undefined;
  const badge = !view?.stage ? null : view.stage === "CLEARED" || view.stage === "SETTLED" ? "RESOLVED ABOVE COST" : `RECOVERY IN FLIGHT · ${view.stage}`;
  return (
    <div className="panel">
      <h2>Cashier terminal</h2>
      <button onClick={submit}>Submit B1 (Metformin 500 mg × 1000, TN)</button>
      {resp && (
        <pre className="money" style={{ fontSize: 12 }}>
          {`112-AN ${resp["112-AN"]}   509-F9 total paid ${usd(resp["509-F9"] as number)}`}
        </pre>
      )}
      {badge && <span className="pill">{badge}</span>}
    </div>
  );
}
