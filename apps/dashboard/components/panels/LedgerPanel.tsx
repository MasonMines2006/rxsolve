"use client";
/** Ledger panel (UI-03). Owner: P3. Account balances only; the recovered and fee totals live in the header hero. */
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
