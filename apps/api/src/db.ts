/**
 * Storage (DESIGN.md section 10). Owner: P1.
 *
 * One small Collection interface with two backends: TigerData (Postgres + TimescaleDB) when DATABASE_URL
 * is set, in-memory otherwise, so anyone can run the API with no cloud account. Keep call sites on this
 * interface. On Postgres each collection is a table of jsonb documents; the append-only, timestamped
 * ones are hypertables, and settled recoveries roll up in a continuous aggregate (recoverySeries).
 */
import { SQL } from "bun";
import type {
  ChannelMessage, Claim, Decision, Evidence, LedgerSettlement, RecoveryPoint, Remittance, Stage, Ticket, Verdict,
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

const parse = <T>(v: unknown) => (typeof v === "string" ? JSON.parse(v) : v) as T;

/** Table: key (null for keyless collections), ts (hypertable time column), doc (the record as jsonb). */
class PgCollection<T extends Doc> implements Collection<T> {
  constructor(private sql: SQL, private name: string, private key?: keyof T & string) {}
  private ts(doc: T) { return typeof doc.ts === "string" ? doc.ts : null; }
  async insert(doc: T) {
    await this.sql.unsafe(
      `INSERT INTO ${this.name} (key, ts, doc) VALUES ($1, coalesce($2::timestamptz, now()), $3::text::jsonb)`,
      [this.key ? doc[this.key] : null, this.ts(doc), JSON.stringify(doc)],
    );
  }
  async upsert(doc: T) {
    await this.sql.unsafe(
      `INSERT INTO ${this.name} (key, ts, doc) VALUES ($1, coalesce($2::timestamptz, now()), $3::text::jsonb)
       ON CONFLICT (key) DO UPDATE SET doc = EXCLUDED.doc`,
      [doc[this.key!], this.ts(doc), JSON.stringify(doc)],
    );
  }
  async patch(k: string, fields: Partial<T>) {
    await this.sql.unsafe(`UPDATE ${this.name} SET doc = doc || $2::text::jsonb WHERE key = $1`, [k, JSON.stringify(fields)]);
  }
  async get(k: string) {
    const rows = await this.sql.unsafe(`SELECT doc FROM ${this.name} WHERE key = $1`, [k]);
    return rows.length ? parse<T>(rows[0].doc) : null;
  }
  async find(filter: Partial<T> = {}) {
    const rows = await this.sql.unsafe(`SELECT doc FROM ${this.name} WHERE doc @> $1::text::jsonb ORDER BY ts`, [JSON.stringify(filter)]);
    return rows.map((r: { doc: unknown }) => parse<T>(r.doc));
  }
}

export type ClaimRecord = Claim & { stage?: Stage; reason?: string; verdict?: Verdict };
export type AppealRecord = Ticket & { status: string; deadline: string | null; decision?: Decision };
export type PolicyRecord = { pharmacy_id: string; auto_file_max: number; paused: boolean };
export type AuditRecord = { claim_id: string; ts: string; stage: Stage; reason?: string };
/** recovered/fees are the settlement's transfer totals, flattened so the continuous aggregate can sum them. */
export type LedgerEventRecord = LedgerSettlement & { pharmacy_id: string; ts: string; recovered: number; fees: number };

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

/** Append-only, timestamped collections: TimescaleDB hypertables partitioned on ts. */
const HYPERTABLES = ["ledger_events", "transcript", "audit"] as const;

/** Demo-scale bucket: a four-minute demo needs several points. A real pharmacy would use '1 hour'. */
export const RECOVERY_BUCKET_SECONDS = 15;

export type Db = {
  claims: Collection<ClaimRecord>;
  evidence: Collection<Evidence>;
  appeals: Collection<AppealRecord>;
  remittances: Collection<Remittance>;
  policy: Collection<PolicyRecord>;
  ledger_events: Collection<LedgerEventRecord>;
  transcript: Collection<ChannelMessage>;
  audit: Collection<AuditRecord>;
};

let db: Db | null = null;
let sql: SQL | null = null;
let hasRollup = false; // true once the continuous aggregate exists

function pg(): SQL {
  sql ??= new SQL(config.databaseUrl);
  return sql;
}

export function getDb(): Db {
  if (!db) {
    const out: Record<string, Collection<Doc>> = {};
    for (const [name, key] of Object.entries(SCHEMA)) {
      out[name] = config.databaseUrl ? new PgCollection(pg(), name, key) : new MemoryCollection(key);
    }
    db = out as unknown as Db;
  }
  return db;
}

/** Tests only: start from an empty store. */
export function resetDb() { db = null; }

/**
 * Creates tables, indexes, hypertables and the recovery continuous aggregate. Idempotent. On plain
 * Postgres (no timescaledb extension) the tables still work and recoverySeries buckets in the API.
 */
export async function ensureSchema() {
  if (!config.databaseUrl) return;
  const s = pg();
  for (const [name, key] of Object.entries(SCHEMA)) {
    await s.unsafe(`CREATE TABLE IF NOT EXISTS ${name} (key text, ts timestamptz NOT NULL DEFAULT now(), doc jsonb NOT NULL)`);
    if (key) await s.unsafe(`CREATE UNIQUE INDEX IF NOT EXISTS ${name}_key ON ${name} (key)`);
    await s.unsafe(`CREATE INDEX IF NOT EXISTS ${name}_doc ON ${name} USING gin (doc jsonb_path_ops)`);
  }
  await s.unsafe(`CREATE INDEX IF NOT EXISTS claims_state_verdict ON claims ((doc->>'state'), (doc->'verdict'->>'verdict'))`);
  await s.unsafe(`CREATE INDEX IF NOT EXISTS claims_fill_date ON claims ((doc->>'fill_date'))`);
  await s.unsafe(`CREATE INDEX IF NOT EXISTS appeals_status_deadline ON appeals ((doc->>'status'), (doc->>'deadline'))`);

  try {
    await s.unsafe(`CREATE EXTENSION IF NOT EXISTS timescaledb`);
    for (const t of HYPERTABLES) {
      await s.unsafe(`SELECT create_hypertable('${t}', by_range('ts'), if_not_exists => TRUE, migrate_data => TRUE)`);
      await s.unsafe(`CREATE INDEX IF NOT EXISTS ${t}_claim_ts ON ${t} ((doc->>'claim_id'), ts DESC)`);
    }
    await s.unsafe(`
      CREATE MATERIALIZED VIEW IF NOT EXISTS recovery_series
      WITH (timescaledb.continuous, timescaledb.materialized_only = false) AS
      SELECT time_bucket(INTERVAL '${RECOVERY_BUCKET_SECONDS} seconds', ts) AS bucket,
             sum((doc->>'recovered')::numeric) AS recovered,
             sum((doc->>'fees')::numeric) AS fees,
             count(*) AS settlements
      FROM ledger_events
      GROUP BY bucket
      WITH NO DATA`);
    await s.unsafe(`SELECT add_continuous_aggregate_policy('recovery_series',
      start_offset => INTERVAL '7 days', end_offset => INTERVAL '${RECOVERY_BUCKET_SECONDS} seconds',
      schedule_interval => INTERVAL '1 minute', if_not_exists => TRUE)`);
    hasRollup = true;
  } catch (err) {
    console.warn(`db: TimescaleDB unavailable, using plain Postgres tables (${(err as Error).message})`);
  }
}

const cents = (x: number) => Math.round(x * 100) / 100;

/** Settled recoveries per time bucket, oldest first. Real-time: includes rows not yet materialized. */
export async function recoverySeries(): Promise<RecoveryPoint[]> {
  if (config.databaseUrl && hasRollup) {
    const rows = await pg().unsafe(`SELECT bucket, recovered, fees, settlements FROM recovery_series ORDER BY bucket`);
    return rows.map((r: { bucket: Date; recovered: string; fees: string; settlements: string }) => ({
      bucket: new Date(r.bucket).toISOString(),
      recovered: cents(Number(r.recovered)),
      fees: cents(Number(r.fees)),
      settlements: Number(r.settlements),
    }));
  }
  const size = RECOVERY_BUCKET_SECONDS * 1000;
  const buckets = new Map<number, RecoveryPoint>();
  for (const ev of await getDb().ledger_events.find()) {
    const b = Math.floor(Date.parse(ev.ts) / size) * size;
    const p = buckets.get(b) ?? { bucket: new Date(b).toISOString(), recovered: 0, fees: 0, settlements: 0 };
    p.recovered = cents(p.recovered + ev.recovered);
    p.fees = cents(p.fees + ev.fees);
    p.settlements += 1;
    buckets.set(b, p);
  }
  return [...buckets.entries()].sort(([a], [b]) => a - b).map(([, p]) => p);
}
