/**
 * Capital One Nessie ledger. Owner: P1 (INF-01 probe, INF-04 implementation).
 *
 * T+0: probe classic vs v2 (DESIGN.md 11.1).
 *   classic: http://api.nessieisreal.com, key as ?key=, money via POST /accounts/{id}/transfers (or /bills)
 *   v2:      /v2/accounts, header auth
 * Record the answer in NESSIE_VERSION and docs/STATUS.md. If transfers are unavailable, use bills.
 * Keep a map of ledger entity id (PH-MEADOWBROOK, PBM-PORTAL, ...) -> Nessie account _id.
 */
import type { Transfer } from "@rxsolve/contracts";
import type { Ledger } from "./index";

export class NessieLedger implements Ledger {
  async ensureAccounts(_ids: string[]): Promise<void> { throw new Error("TODO(INF-04)"); }
  async hasAccount(_id: string): Promise<boolean> { throw new Error("TODO(INF-04)"); }
  async transfer(_t: Transfer): Promise<string> { throw new Error("TODO(INF-04)"); }
  async balances(): Promise<Record<string, number>> { throw new Error("TODO(INF-04)"); }
}
