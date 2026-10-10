/** Settlement on an APPROVED appeal (DESIGN.md 11.1). Owner: P1. */
import type { Claim, LedgerSettlement, LedgerSummary, Remittance, Transfer } from "@rxsolve/contracts";
import { config } from "../config";
import { getDb } from "../db";
import { bus } from "../events";
import { getLedger, pbmAccount } from "./index";

const cents = (x: number) => Math.round(x * 100) / 100;

export async function settleRecovery(claim: Claim, delta: number): Promise<LedgerSettlement> {
  const remittance: Remittance = {
    remittance_id: `REM-${claim.claim_id.replace(/^RXS-/, "")}`,
    type: "835-style",
    payer: pbmAccount(claim.pbm),
    payee: claim.pharmacy_id,
    claim_id: claim.claim_id,
    paid_original: claim.paid_amount,
    adjustment: cents(delta),
    paid_total: cents(claim.paid_amount + delta),
    reason: "MAC appeal approved",
    posted_at: new Date().toISOString(),
  };
  const transfers: Transfer[] = [
    {
      from: remittance.payer, to: claim.pharmacy_id, amount: remittance.adjustment,
      kind: "remittance_adjustment", memo: `${remittance.remittance_id} remittance adjustment ${claim.claim_id}`,
    },
    {
      from: claim.pharmacy_id, to: config.platformAccount, amount: cents(delta * config.feePct),
      kind: "contingency_fee", memo: `contingency fee ${claim.claim_id}`,
    },
  ];
  for (const t of transfers) await getLedger().transfer(t);
  const settlement: LedgerSettlement = { event: "RECOVERY_SETTLED", claim_id: claim.claim_id, transfers };
  await getDb().remittances.insert(remittance);
  await getDb().ledger_events.insert({
    ...settlement, pharmacy_id: claim.pharmacy_id, ts: new Date().toISOString(),
    recovered: transfers[0]!.amount, fees: transfers[1]!.amount,
  });
  bus.emit("ledger.settled", claim.claim_id, { ...settlement, remittance });
  await emitBalances();
  return settlement;
}

/** Recovered-to-date and fees are computed from ledger events, never stored counters. */
export async function ledgerSummary(): Promise<LedgerSummary> {
  let recovered = 0;
  let fees = 0;
  for (const ev of await getDb().ledger_events.find()) {
    for (const t of ev.transfers) {
      if (t.kind === "remittance_adjustment") recovered += t.amount;
      if (t.kind === "contingency_fee") fees += t.amount;
    }
  }
  return { balances: await getLedger().balances(), recovered_to_date: cents(recovered), fees_to_date: cents(fees) };
}

export async function emitBalances() {
  bus.emit("ledger.balances", null, await ledgerSummary());
}
