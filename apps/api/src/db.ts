/**
 * Storage (DESIGN.md section 10). Owner: P1.
 *
 * One small Collection interface with two backends: MongoDB Atlas when MONGO_URI is set, in-memory
 * otherwise, so anyone can run the API with no Atlas account. Keep call sites on this interface.
 */
import { MongoClient, type Db as MongoDb } from "mongodb";
import type {
  ChannelMessage, Claim, Decision, Evidence, LedgerSettlement, Remittance, Stage, Ticket, Verdict,
} from "@rxsolve/contracts";
import { config } from "./config";

type Doc = Record<string, unknown>;

export interface Collection<T extends Doc> {
  insert(doc: T): Promise<void>;
  upsert(doc: T): Promise<void>; // replace by key field
  patch(key: string, fields: Partial<T>): Promise<void>;
  get(key: string): Promise<T | null>;
  find(filter?: Partial<T>): Promise<T[]>;
}

class MemoryCollection<T extends Doc> implements Collection<T> {
  private docs: T[] = [];
  constructor(private key?: keyof T & string) {}
  private idx(k: string) {
    return this.key ? this.docs.findIndex((d) => d[this.key!] === k) : -1;
  }
  async insert(doc: T) { this.docs.push(structuredClone(doc)); }
  async upsert(doc: T) {
    const i = this.idx(doc[this.key!] as string);
    if (i >= 0) this.docs[i] = structuredClone(doc); else this.docs.push(structuredClone(doc));
  }
  async patch(k: string, fields: Partial<T>) {
    const i = this.idx(k);
    if (i >= 0) this.docs[i] = { ...this.docs[i]!, ...structuredClone(fields) };
  }
  async get(k: string) {
    const i = this.idx(k);
    return i >= 0 ? structuredClone(this.docs[i]!) : null;
  }
  async find(filter: Partial<T> = {}) {
    return this.docs.filter((d) => Object.entries(filter).every(([f, v]) => d[f] === v)).map((d) => structuredClone(d));
  }
}

class MongoCollection<T extends Doc> implements Collection<T> {
  constructor(private db: MongoDb, private name: string, private key?: keyof T & string) {}
  private get c() { return this.db.collection(this.name); }
  async insert(doc: T) { await this.c.insertOne({ ...doc }); }
  async upsert(doc: T) { await this.c.replaceOne({ [this.key!]: doc[this.key!] }, doc, { upsert: true }); }
  async patch(k: string, fields: Partial<T>) { await this.c.updateOne({ [this.key!]: k }, { $set: fields }); }
  async get(k: string) { return (await this.c.findOne({ [this.key!]: k }, { projection: { _id: 0 } })) as T | null; }
  async find(filter: Partial<T> = {}) {
    return (await this.c.find(filter as Doc, { projection: { _id: 0 } }).toArray()) as unknown as T[];
  }
}

export type ClaimRecord = Claim & { stage?: Stage; reason?: string; verdict?: Verdict };
export type AppealRecord = Ticket & { status: string; deadline: string | null; decision?: Decision };
export type PolicyRecord = { pharmacy_id: string; auto_file_max: number; paused: boolean };
export type AuditRecord = { claim_id: string; ts: string; stage: Stage; reason?: string };

const SCHEMA = {
  claims: "claim_id",
  evidence: "claim_id",
  appeals: "ticket_id",
  remittances: "remittance_id",
  policy: "pharmacy_id",
  ledger_events: undefined,
  transcript: undefined,
  audit: undefined,
} as const;

export type Db = {
  claims: Collection<ClaimRecord>;
  evidence: Collection<Evidence>;
  appeals: Collection<AppealRecord>;
  remittances: Collection<Remittance>;
  policy: Collection<PolicyRecord>;
  ledger_events: Collection<LedgerSettlement & { pharmacy_id: string }>;
  transcript: Collection<ChannelMessage>;
  audit: Collection<AuditRecord>;
};

let db: Db | null = null;

export function getDb(): Db {
  if (!db) {
    const out: Record<string, Collection<Doc>> = {};
    if (config.mongoUri) {
      const mongo = new MongoClient(config.mongoUri).db("rxsolve");
      for (const [name, key] of Object.entries(SCHEMA)) out[name] = new MongoCollection(mongo, name, key);
    } else {
      for (const [name, key] of Object.entries(SCHEMA)) out[name] = new MemoryCollection(key);
    }
    db = out as unknown as Db;
  }
  return db;
}

/** Tests only: start from an empty store. */
export function resetDb() { db = null; }

export async function ensureIndexes() {
  if (!config.mongoUri) return;
  const mongo = new MongoClient(config.mongoUri).db("rxsolve");
  await mongo.collection("claims").createIndex({ claim_id: 1 }, { unique: true });
  await mongo.collection("claims").createIndex({ state: 1, "verdict.verdict": 1 });
  await mongo.collection("claims").createIndex({ fill_date: 1 });
  await mongo.collection("evidence").createIndex({ claim_id: 1 });
  await mongo.collection("appeals").createIndex({ status: 1, deadline: 1 });
  await mongo.collection("ledger_events").createIndex({ claim_id: 1, pharmacy_id: 1 });
  await mongo.collection("remittances").createIndex({ claim_id: 1 });
  await mongo.collection("transcript").createIndex({ claim_id: 1, ts: 1 });
  await mongo.collection("audit").createIndex({ claim_id: 1, ts: 1 });
}
