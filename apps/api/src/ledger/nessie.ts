/**
 * Capital One Nessie Classic v1 ledger (INF-04).
 *
 * The logical RxSolve actors live as Checking accounts under one sandbox customer. Each account is
 * found by its nickname on startup, so repeated boots do not create duplicate customers/accounts.
 * Nessie uses the API key as a query parameter; never include the request URL in an error message.
 */
import type { Transfer } from "@rxsolve/contracts";
import type { Ledger } from "./index";
import { config } from "../config";

type JsonObject = Record<string, unknown>;
type NessieFetch = (input: URL, init?: RequestInit) => Promise<Response>;
type NessieOptions = {
  key?: string;
  baseUrl?: string;
  version?: string;
  openingBalance?: number;
  fetch?: NessieFetch;
};

const DEFAULT_BASE_URL = "https://api.nessieisreal.com";
const DEFAULT_OPENING_BALANCE = 100_000;
const SANDBOX_CUSTOMER = { first_name: "RxSolve", last_name: "Demo" };

function asObject(value: unknown): JsonObject | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as JsonObject
    : null;
}

function unwrapObject(value: unknown): JsonObject | null {
  const object = asObject(value);
  if (!object) return null;
  return asObject(object.data) ?? asObject(object.customer) ?? asObject(object.account) ?? object;
}

function asRecords(value: unknown): JsonObject[] {
  if (Array.isArray(value)) return value.map(asObject).filter((item): item is JsonObject => item !== null);
  const object = asObject(value);
  if (!object) return [];
  for (const key of ["data", "results", "customers", "accounts"]) {
    if (Array.isArray(object[key])) return asRecords(object[key]);
  }
  return [];
}

function entityId(value: unknown): string | null {
  const object = unwrapObject(value);
  const id = object?._id ?? object?.id;
  return typeof id === "string" && id !== "" ? id : null;
}

function displayName(value: unknown): string {
  if (typeof value === "string") return value.trim().slice(0, 300);
  const object = asObject(value);
  if (!object) return "";
  for (const key of ["message", "error_message", "detail", "error"]) {
    if (typeof object[key] === "string") return String(object[key]).slice(0, 300);
  }
  const errors = object.errors ?? object.validation_errors ?? object.details;
  if (Array.isArray(errors)) {
    return errors.map((entry) => {
      const item = asObject(entry);
      if (!item) return typeof entry === "string" ? entry : "";
      const field = item.field ?? item.param ?? item.path;
      const message = item.message ?? item.error ?? item.reason;
      if (typeof message === "string") return `${typeof field === "string" ? `${field}: ` : ""}${message}`;
      return JSON.stringify(item);
    }).filter(Boolean).join("; ").slice(0, 300);
  }
  return JSON.stringify(object).slice(0, 300);
}

export class NessieLedger implements Ledger {
  private readonly key: string;
  private readonly baseUrl: string;
  private readonly version: string;
  private readonly openingBalance: number;
  private readonly fetcher: NessieFetch;
  private customerId: string | null = null;
  private readonly accountIds = new Map<string, string>();

  constructor(options: NessieOptions = {}) {
    this.key = options.key ?? config.nessieKey;
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
    this.version = options.version ?? config.nessieVersion;
    this.openingBalance = options.openingBalance ?? DEFAULT_OPENING_BALANCE;
    this.fetcher = options.fetch ?? fetch;
  }

  private requireClassicCredentials(): void {
    if (this.version !== "v1") throw new Error(`Unsupported Nessie version: ${this.version}; only classic v1 is implemented`);
    if (!this.key) throw new Error("NESSIE_KEY is required when LEDGER_BACKEND=nessie");
  }

  private async request(path: string, init: RequestInit = {}): Promise<unknown> {
    this.requireClassicCredentials();
    const url = new URL(`${this.baseUrl}${path}`);
    url.searchParams.set("key", this.key);
    const method = init.method ?? "GET";
    let response: Response;
    try {
      response = await this.fetcher(url, init);
    } catch {
      throw new Error(`Nessie ${method} ${path} could not be reached`);
    }

    const text = await response.text();
    let body: unknown = null;
    if (text) {
      try {
        body = JSON.parse(text) as unknown;
      } catch {
        body = text;
      }
    }
    if (!response.ok) {
      const detail = displayName(body).replaceAll(this.key, "[redacted]");
      throw new Error(`Nessie ${method} ${path} failed with HTTP ${response.status}${detail ? `: ${detail}` : ""}`);
    }
    return body;
  }

  private async listCustomers(): Promise<JsonObject[]> {
    return asRecords(await this.request("/customers"));
  }

  private async ensureCustomer(): Promise<string> {
    if (this.customerId) return this.customerId;
    const find = (customers: JsonObject[]) => customers.find((customer) =>
      String(customer.first_name ?? "").toLowerCase() === SANDBOX_CUSTOMER.first_name.toLowerCase()
      && String(customer.last_name ?? "").toLowerCase() === SANDBOX_CUSTOMER.last_name.toLowerCase(),
    );
    let existing = find(await this.listCustomers());
    let id = entityId(existing);
    if (!id) {
      const created = await this.request("/customers", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ...SANDBOX_CUSTOMER,
          address: { street_number: "1", street_name: "RxSolve Way", city: "Durham", state: "NC", zip: "27701" },
          phone_number: "5550100000",
        }),
      });
      id = entityId(created);
      if (!id) id = entityId(find(await this.listCustomers()));
    }
    if (!id) throw new Error("Nessie did not return the RxSolve sandbox customer id");
    this.customerId = id;
    return id;
  }

  async ensureAccounts(ids: string[]): Promise<void> {
    const uniqueIds = [...new Set(ids.filter((id) => id.trim() !== ""))];
    if (uniqueIds.length === 0) return;
    this.requireClassicCredentials();
    const customerId = await this.ensureCustomer();
    let accounts = asRecords(await this.request(`/customers/${encodeURIComponent(customerId)}/accounts`));

    for (const logicalId of uniqueIds) {
      if (this.accountIds.has(logicalId)) continue;
      let remoteId = entityId(accounts.find((account) => account.nickname === logicalId));
      if (!remoteId) {
        const created = await this.request(`/customers/${encodeURIComponent(customerId)}/accounts`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            type: "Checking",
            nickname: logicalId,
            rewards: 0,
            balance: this.openingBalance,
          }),
        });
        remoteId = entityId(created);
        if (!remoteId) {
          accounts = asRecords(await this.request(`/customers/${encodeURIComponent(customerId)}/accounts`));
          remoteId = entityId(accounts.find((account) => account.nickname === logicalId));
        }
      }
      if (!remoteId) throw new Error(`Nessie did not return an account id for ${logicalId}`);
      this.accountIds.set(logicalId, remoteId);
    }
  }

  async hasAccount(id: string): Promise<boolean> {
    return this.accountIds.has(id);
  }

  async transfer(transfer: Transfer): Promise<string> {
    this.requireClassicCredentials();
    const from = this.accountIds.get(transfer.from);
    const to = this.accountIds.get(transfer.to);
    if (!from || !to) throw new Error(`Nessie account mapping missing for ${!from ? transfer.from : transfer.to}`);
    const amount = Math.round(transfer.amount * 100) / 100;
    if (!Number.isFinite(amount) || amount <= 0) throw new Error("Nessie transfer amount must be a positive finite dollar amount");
    if (transfer.kind === "opening") throw new Error("Nessie opening balances are created with their accounts");

    const result = await this.request(`/accounts/${encodeURIComponent(from)}/transfers`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        medium: "balance",
        payee_id: to,
        amount,
        transaction_date: new Date().toISOString().slice(0, 10),
        status: "completed",
        description: transfer.memo ?? `${transfer.kind}: ${transfer.from} to ${transfer.to}`,
      }),
    });
    const id = entityId(result);
    if (!id) throw new Error("Nessie transfer response did not include a transaction id");
    return id;
  }

  async balances(): Promise<Record<string, number>> {
    this.requireClassicCredentials();
    const entries = await Promise.all([...this.accountIds].map(async ([logicalId, remoteId]) => {
      const account = unwrapObject(await this.request(`/accounts/${encodeURIComponent(remoteId)}`));
      const balance = Number(account?.balance);
      if (!Number.isFinite(balance)) throw new Error(`Nessie account ${logicalId} returned an invalid balance`);
      return [logicalId, Math.round(balance * 100) / 100] as const;
    }));
    return Object.fromEntries(entries);
  }
}
