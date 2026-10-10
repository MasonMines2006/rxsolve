/** AGT-08: phone negotiator against the simulated rep over a local WebSocket; stub codec, model stubbed, no network. */
import { afterAll, beforeEach, expect, test } from "bun:test";
import type { Action, Claim, Decision, Evidence, Ticket } from "@rxsolve/contracts";
import type { ChannelAdapter } from "../src/adapters";
import { PhoneAdapter, PhoneError, placeCall } from "../src/adapters/phone";
import { stubCodec } from "../src/adapters/phone-audio";
import { startRepSim } from "../src/adapters/phone-sim/rep";
import { onDenial, resetNegotiation, type PhoneCaller } from "../src/agents/negotiation";
import { citationTemplate, readRepLine, spokenCitation } from "../src/agents/phone-text";
import { config } from "../src/config";
import { getDb, resetDb } from "../src/db";

const STATUTE = "TN Code 56-7-3109";
const claim = { claim_id: "RXS-0801", pbm: "PBM_PORTAL", state: "TN" } as unknown as Claim;
const ev: Evidence = {
  claim_id: "RXS-0801", statute: STATUTE, entitlement: "the PBM must reimburse at or above acquisition cost.",
  attachments: ["inv.pdf"], required_fields_present: ["ndc"], spec_version: "v1", completeness: 1,
  fields: { paid_amount: 6.4, acquisition_cost: 12.8 }, delta: 6.4, appeal_deadline: "2099-01-01",
};
const denial: Decision = { claim_id: "RXS-0801", ticket_id: "T-1", status: "DENIED", reason: "disputed", field: null, delta: null, raw: "disputed rate" };
const ticket: Ticket = { claim_id: "RXS-0801", pbm: "PBM_PORTAL", channel: "portal", ticket_id: "T-1", submitted_at: "", expected_response_by: "" };

const sims: ReturnType<typeof startRepSim>[] = [];
function rep(c: { statute: string; delta: number } = { statute: STATUTE, delta: 6.4 }, o: Parameters<typeof startRepSim>[0] = {}) {
  const s = startRepSim(o);
  s.register(claim.claim_id, c);
  sims.push(s);
  return s;
}
afterAll(() => sims.forEach((s) => s.stop()));
beforeEach(async () => {
  Object.assign(config, { databaseUrl: "", agentApiKey: "", elevenlabsApiKey: "", elevenlabsVoiceId: "" });
  resetNegotiation();
  await resetDb();
});

test("rep concedes when the statute and figure are cited; the call is in the transcript", async () => {
  const s = rep();
  const r = await placeCall(claim, ev, { repUrl: s.url, codec: stubCodec });
  expect(r).toMatchObject({ status: "APPROVED", delta: 6.4, turns: 1 });
  const t = await getDb().transcript.find({ claim_id: claim.claim_id });
  expect(t.every((m) => m.channel === "phone")).toBe(true);
  expect(t.map((m) => m.direction)).toEqual(["in", "out", "in"]);
  expect(t[1]!.text).toContain(STATUTE);
  expect(t[2]!.text).toContain("approved");
});

test("rep denies after the bounded turns when the statute on file does not match", async () => {
  const s = rep({ statute: "XX Code 1-1-1", delta: 6.4 });
  const r = await placeCall(claim, ev, { repUrl: s.url, maxTurns: 3 });
  expect(r).toMatchObject({ status: "DENIED", delta: null, turns: 3 });
  expect((await getDb().transcript.find({ claim_id: claim.claim_id })).filter((m) => m.direction === "out")).toHaveLength(3);
});

test("a silent or unreachable line throws PhoneError instead of hanging", async () => {
  const s = rep(undefined, { silent: true });
  await expect(placeCall(claim, ev, { repUrl: s.url, turnTimeoutMs: 100 })).rejects.toBeInstanceOf(PhoneError);
  await expect(placeCall(claim, ev, { repUrl: "ws://localhost:1", turnTimeoutMs: 200 })).rejects.toBeInstanceOf(PhoneError);
});

test("a passed appeal deadline blocks the call before dialing", async () => {
  const s = rep();
  const late = { appealDeadline: "2026-01-01", now: new Date("2026-02-01T00:00:00Z") };
  await expect(placeCall(claim, ev, { repUrl: s.url, ...late })).rejects.toBeInstanceOf(PhoneError);
  expect(await getDb().transcript.find({ claim_id: claim.claim_id })).toHaveLength(0);
});

test("model wording is kept only when it holds the statute and the figure", async () => {
  expect(await spokenCitation(ev, 0, "", async () => ({ text: "Cheaper please" }) as never)).toBe(citationTemplate(ev, 0));
  const good = `Under ${STATUTE} the underpayment is $6.40, please approve.`;
  expect(await spokenCitation(ev, 0, "", async () => ({ text: good }) as never)).toBe(good);
  expect(await spokenCitation(ev, 0, "", async () => { throw new Error("down"); })).toBe(citationTemplate(ev, 0));
});

test("a model cannot read an approval out of a line that has none", async () => {
  const ask = (async () => ({ outcome: "approved" })) as never;
  expect(await readRepLine("Let me check with my supervisor.", ask)).toBe("unclear");
  expect(await readRepLine("The appeal is approved.", ask)).toBe("approved");
  expect(await readRepLine("I cannot approve this.", ask)).toBe("denied");
});

test("the spoken wording is the template with no model, and the rule alone decides", async () => {
  const s = rep();
  const asked: string[] = [];
  const r = await placeCall(claim, ev, {
    repUrl: s.url, ask: (async (_: unknown, p: string) => (asked.push(p), { text: `Under ${STATUTE}, $6.40 is owed.` })) as never,
  });
  expect(asked.length).toBeGreaterThan(0);
  expect(r.status).toBe("APPROVED");
});

test("PhoneAdapter submit places the call and poll returns the rep's decision", async () => {
  const a = new PhoneAdapter({ repUrl: rep().url });
  const t = await a.submit(claim, ev);
  expect(t.channel).toBe("phone");
  expect(await a.poll(t)).toMatchObject({ status: "APPROVED", delta: 6.4, reason: null });
});

const adapter = (replies: string[]): ChannelAdapter => ({
  channel: "portal",
  submit: async () => ticket,
  poll: async () => null,
  reply: async (t, m) => (replies.push(m.note ?? ""), { ...t, ticket_id: "T-2" }),
});

async function dispute(opts: Parameters<typeof onDenial>[5], replies: string[] = []): Promise<Action> {
  const a = adapter(replies);
  const first = await onDenial(claim, ev, denial, a, ticket, opts);
  expect(first.kind).toBe("REFILED"); // the single rebuttal
  return onDenial(claim, ev, denial, a, ticket, opts);
}

test("second dispute: phone approval refiles referencing the call", async () => {
  const replies: string[] = [];
  const phone: PhoneCaller = async () => ({ status: "APPROVED", delta: 6.4, raw: "ok", turns: 1, ref: "CALL-1" });
  const a = await dispute({ phone }, replies);
  expect(a.kind).toBe("REFILED");
  expect(replies.at(-1)).toContain("Approved by phone (call CALL-1)");
});

test("second dispute: rep denial escalates, call failure abandons, no line escalates", async () => {
  const denied: PhoneCaller = async () => ({ status: "DENIED", delta: null, raw: "no", turns: 3, ref: "CALL-2" });
  expect((await dispute({ phone: denied })).kind).toBe("ESCALATED");
  resetNegotiation();
  const broken: PhoneCaller = async () => { throw new PhoneError("rep went silent"); };
  expect(await dispute({ phone: broken })).toMatchObject({ kind: "ABANDONED", reason: expect.stringContaining("rep went silent") });
  resetNegotiation();
  expect((await dispute({})).kind).toBe("ESCALATED");
});

test("end to end: a configured sim line flips a dispute to a refile through the real call", async () => {
  const replies: string[] = [];
  const s = rep();
  const a = await dispute({ phoneOpts: { repUrl: s.url, codec: stubCodec } }, replies);
  expect(a.kind).toBe("REFILED");
  expect(replies.at(-1)).toContain("Approved by phone");
});
