"use client";
/** Ledger panel (UI-03). Owner: P3. Every number here comes from the ledger, never a constant. */
import { type PanelProps, usd } from "./types";

export function LedgerPanel({ live }: PanelProps) {
  const l = live.ledger;
  return (
    <div className="panel">
      <h2>Ledger</h2>
      {!l ? <p className="muted">Waiting for balances…</p> : (
        <>
          <p>Recovered to date <strong className="money">{usd(l.recovered_to_date)}</strong> · fees <span className="money">{usd(l.fees_to_date)}</span></p>
          <ul className="plain">
            {Object.entries(l.balances).map(([acct, bal]) => (
              <li key={acct}>{acct} <span className="money" style={{ float: "right" }}>{usd(bal)}</span></li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
