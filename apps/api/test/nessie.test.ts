import { expect, test } from "bun:test";
import type { Transfer } from "@rxsolve/contracts";
import { NessieLedger } from "../src/ledger/nessie";

type Json = Record<string, unknown>;
type Fetcher = (input: URL, init?: RequestInit) => Promise<Response>;

function fakeNessie() {
  const customers: Json[] = [];
  const accounts = new Map<string, Json>();
  const requests: { method: string; path: string; key: string | null; body: Json | null }[] = [];
  let customerSequence = 0;
  let accountSequence = 0;
  let transferSequence = 0;

  const fetcher: Fetcher = async (input, init = {}) => {
    const url = new URL(String(input));
    const method = init.method ?? "GET";
    const path = decodeURIComponent(url.pathname);
    const body = typeof init.body === "string" ? JSON.parse(init.body) as Json : null;
    requests.push({ method, path, key: url.searchParams.get("key"), body });

    if (path === "/customers" && method === "GET") return Response.json(customers);
    if (path === "/customers" && method === "POST") {
      const customer = { ...body, _id: `customer-${++customerSequence}` };
      customers.push(customer);
      return Response.json(customer, { status: 201 });
    }

    const customerAccounts = path.match(/^\/customers\/([^/]+)\/accounts$/);
    if (customerAccounts && method === "GET") {
      return Response.json([...accounts.values()].filter((account) => account.customer_id === customerAccounts[1]));
    }
    if (customerAccounts && method === "POST") {
      const account = { ...body, _id: `account-${++accountSequence}`, customer_id: customerAccounts[1] };
      accounts.set(String(account._id), account);
      return Response.json(account, { status: 201 });
    }

    const accountPath = path.match(/^\/accounts\/([^/]+)$/);
    if (accountPath && method === "GET") {
      const account = accounts.get(accountPath[1]!);
      return account ? Response.json(account) : Response.json({ message: "unknown account" }, { status: 404 });
    }

    const transferPath = path.match(/^\/accounts\/([^/]+)\/transfers$/);
    if (transferPath && method === "POST") {
      const from = accounts.get(transferPath[1]!);
      const to = accounts.get(String(body?.payee_id));
      if (!from || !to) return Response.json({ message: "unknown account" }, { status: 404 });
      const amount = Number(body?.amount);
      from.balance = Number(from.balance) - amount;
      to.balance = Number(to.balance) + amount;
      return Response.json({ _id: `transfer-${++transferSequence}` }, { status: 201 });
    }
    return Response.json({ message: `unexpected ${method} ${path}` }, { status: 404 });
  };

  return { fetcher, requests, accounts, customers };
}

const ids = ["PH-MEADOWBROOK", "PBM-PORTAL", "RXSOLVE-PLATFORM"];
const options = (fake: ReturnType<typeof fakeNessie>) => ({
  key: "test-key", baseUrl: "https://nessie.test", version: "v1", fetch: fake.fetcher,
});

test("classic v1 account setup is idempotent and transfers/balances use mapped account ids", async () => {
  const fake = fakeNessie();
  const ledger = new NessieLedger(options(fake));

  await ledger.ensureAccounts(ids);
  expect(fake.customers).toHaveLength(1);
  expect(fake.accounts.size).toBe(3);
  expect(await ledger.hasAccount("PH-MEADOWBROOK")).toBe(true);
  expect(await ledger.hasAccount("PATIENT-UNKNOWN")).toBe(false);

  const transfer: Transfer = {
    from: "PBM-PORTAL", to: "PH-MEADOWBROOK", amount: 6.4,
    kind: "remittance_adjustment", memo: "REM-1 remittance adjustment RXS-1",
  };
  expect(await ledger.transfer(transfer)).toBe("transfer-1");
  expect(await ledger.balances()).toEqual({
    "PH-MEADOWBROOK": 100006.4,
    "PBM-PORTAL": 99993.6,
    "RXSOLVE-PLATFORM": 100000,
  });

  await ledger.ensureAccounts(ids);
  const reopened = new NessieLedger(options(fake));
  await reopened.ensureAccounts(ids);
  expect(fake.customers).toHaveLength(1);
  expect(fake.accounts.size).toBe(3);
  expect(fake.requests.filter((request) => request.method === "POST" && request.path === "/customers")).toHaveLength(1);
  expect(fake.requests.filter((request) => request.method === "POST" && request.path.endsWith("/accounts"))).toHaveLength(3);
  expect(fake.requests.every((request) => request.key === "test-key")).toBe(true);
  const post = fake.requests.find((request) => request.path.endsWith("/transfers"))!;
  expect(post.body).toMatchObject({ medium: "balance", payee_id: "account-1", amount: 6.4, status: "completed" });
});

test("a missing key fails before making a Nessie request", async () => {
  let called = false;
  const ledger = new NessieLedger({ key: "", version: "v1", fetch: async () => {
    called = true;
    return Response.json([]);
  } });

  await expect(ledger.ensureAccounts(["PH-MEADOWBROOK"])).rejects.toThrow("NESSIE_KEY is required");
  expect(called).toBe(false);
});

test("HTTP errors are actionable without leaking the API key", async () => {
  const apiKey = "sensitive-test-key";
  const ledger = new NessieLedger({
    key: apiKey,
    version: "v1",
    baseUrl: "https://nessie.test",
    fetch: async () => Response.json({ message: `invalid key ${apiKey}` }, { status: 401 }),
  });

  const failure = await ledger.ensureAccounts(["PH-MEADOWBROOK"]).catch((error: unknown) => error);
  expect(failure).toBeInstanceOf(Error);
  expect((failure as Error).message).toContain("HTTP 401");
  expect((failure as Error).message).not.toContain(apiKey);
  expect((failure as Error).message).toContain("[redacted]");
});

test("invalid transfer amounts are rejected before posting", async () => {
  const fake = fakeNessie();
  const ledger = new NessieLedger(options(fake));
  await ledger.ensureAccounts(ids);
  const postsBefore = fake.requests.filter((request) => request.path.endsWith("/transfers")).length;
  await expect(ledger.transfer({ from: "PBM-PORTAL", to: "PH-MEADOWBROOK", amount: 0, kind: "remittance_adjustment" })).rejects.toThrow("positive finite");
  expect(fake.requests.filter((request) => request.path.endsWith("/transfers"))).toHaveLength(postsBefore);
});
