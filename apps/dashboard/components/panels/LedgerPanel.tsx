"use client";
/** Ledger panel (UI-03). Owner: P3. Every number here comes from the ledger, never a constant. */
import { useEffect, useRef, useState } from "react";
import type { LedgerSummary } from "@rxsolve/contracts";
import { Panel } from "@/components/ui/Panel";
import { accountInfo, balanceChange } from "@/lib/ledger";
import { type PanelProps, usd } from "./types";

export function LedgerPanel({ live }: PanelProps) {
  // GET /api/ledger fills the panel before the first settlement emits ledger.balances.
  const [fetched, setFetched] = useState<LedgerSummary | null>(null);
  const baseline = useRef<LedgerSummary | null>(null);

  useEffect(() => {
    fetch("/api/ledger").then((r) => r.json()).then((s: LedgerSummary) => setFetched(s)).catch(() => {});
  }, []);

  const ledger = live.ledger ?? fetched;
  if (ledger && !baseline.current) baseline.current = fetched ?? ledger;

  return (
    <Panel id="ledger" title="Ledger" aside="change since this page loaded">
      {!ledger ? <p className="empty">Waiting for balances…</p> : (
        <>
          <div className="stat-pair">
            <div><small>Recovered to date</small><b className="money tone-good">{usd(ledger.recovered_to_date)}</b></div>
            <div><small>Fees</small><b className="money">{usd(ledger.fees_to_date)}</b></div>
          </div>
          <ul className="plain accounts">
            {Object.entries(ledger.balances).map(([key, balance]) => {
              const info = accountInfo(key);
              const change = balanceChange(balance, baseline.current?.balances[key]);
              return (
                <li className="account" key={key}>
                  <div>
                    <strong>{info.name}</strong>
                    <small className="muted">{info.role ? `${info.role} · ${key}` : "ledger account"}</small>
                  </div>
                  <span className={`account__change ${change && change < 0 ? "tone-bad" : "tone-good"}`}>
                    {change ? `${change > 0 ? "+" : ""}${usd(change)}` : ""}
                  </span>
                  <b className="money">{typeof balance === "number" && Number.isFinite(balance) ? usd(balance) : "—"}</b>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </Panel>
  );
}
