/**
 * Capital One Nessie ledger. Owner: P1 (INF-01 probe, INF-04 implementation).
 *
 * INF-01 result: classic v1. Base URL https://api.nessieisreal.com (plain http no longer connects), key as ?key=,
 * money via POST /accounts/{id}/transfers (or /bills). v2 needs signed (SigV4-style) headers; not used.
 * Reads never reject a key (they are scoped to it), so a bad key first surfaces as 401 on a write.
 * Every POST with a valid key creates data, even with an empty body or an unknown parent customer id.
 * If transfers are unavailable, use bills.
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
