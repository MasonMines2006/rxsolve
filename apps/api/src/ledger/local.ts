/** In-memory append-only ledger double. Balances are computed from entries, never stored. */
import type { Transfer } from "@rxsolve/contracts";
import type { Ledger } from "./index";

const OPENING_BALANCE = 100_000;

export class LocalLedger implements Ledger {
  private accounts = new Set<string>();
  private entries: Transfer[] = [];

  async ensureAccounts(ids: string[]) {
    for (const id of ids) {
      if (this.accounts.has(id)) continue;
      this.accounts.add(id);
      this.entries.push({ from: "OPENING", to: id, amount: OPENING_BALANCE, kind: "opening" });
    }
  }
  async hasAccount(id: string) { return this.accounts.has(id); }
  async transfer(t: Transfer) {
    this.entries.push(t);
    return `local-${crypto.randomUUID().slice(0, 8)}`;
  }
  async balances() {
    const out: Record<string, number> = {};
    for (const a of this.accounts) out[a] = 0;
    for (const t of this.entries) {
      if (t.to in out) out[t.to]! += t.amount;
      if (t.from in out) out[t.from]! -= t.amount;
    }
    for (const a in out) out[a] = Math.round(out[a]! * 100) / 100;
    return out;
  }
}
