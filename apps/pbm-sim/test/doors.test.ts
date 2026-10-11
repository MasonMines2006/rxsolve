import { afterAll, beforeAll, expect, test } from "bun:test";
import { startSim } from "../src/server";

const FULL_FIELDS = {
  state: "TN",
  ndc: "00378001801",
  rx_number: "RX-DOOR-1",
  fill_date: "2026-10-10",
  invoice_number: "INV-100",
  invoice_date: "2026-10-01",
  acquisition_cost: "12.80",
  wholesaler_attestation: "Signed attestation received",
};

let sim: ReturnType<typeof startSim>;
beforeAll(() => {
  process.env.PBM_SIM_DELAY_SCALE = "0";
  sim = startSim(0);
});
afterAll(() => sim.stop());

function formData(claimId: string, fields: Record<string, string>, delta = "6.40") {
  const data = new FormData();
  data.set("claim_id", claimId);
  data.set("state", fields.state ?? "TN");
  data.set("delta", delta);
  data.set("statute", "TN Code 56-7-3109");
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  data.append("attachment", new Blob(["test PDF"], { type: "application/pdf" }), "invoice.pdf");
  return data;
}

function emailBody(claimId: string, fields: Record<string, string>, delta = "6.40") {
  return [
    "Please review the attached MAC appeal.",
    "",
    `Claim: ${claimId}`,
    "Statute: TN Code 56-7-3109",
    `Amount appealed: ${delta}`,
    ...Object.entries(fields).map(([key, value]) => `${key}: ${value}`),
    "",
    "Attachments: invoice.pdf",
  ].join("\n");
}

function faxPdf(claimId: string, fields: Record<string, string>, delta = "6.40"): Blob {
  const lines = [
    "FAX COVER SHEET: PHARMACY MAC APPEAL",
    `Claim: ${claimId} State: ${fields.state ?? "TN"} Plan: TN Part D`,
    "Statute: TN Code 56-7-3109",
    `Amount appealed: $${delta}`,
    "New appeal",
    "",
    "REQUIRED FIELDS",
    ...Object.entries(fields).map(([key, value]) => `${key}: ${value}`),
    "",
    "Attachments: invoice.pdf",
  ];
  const escape = (line: string) => line.replace(/([\\()])/g, "\\$1");
  const stream = lines.map((line) => `(${escape(line)}) '`).join("\n");
  return new Blob([`%PDF-1.4\nBT\n/F1 10 Tf\n${stream}\nET\n`], { type: "application/pdf" });
}

function pdfLines(bytes: Uint8Array): string[] {
  const source = new TextDecoder("latin1").decode(bytes);
  return [...source.matchAll(/\(((?:\\.|[^\\)])*)\)\s*(?:'|Tj)/g)]
    .map((match) => match[1]!.replace(/\\([\\()])/g, "$1"));
}

test("portal form accepts a B1 appeal and renders the engine decision in its status page", async () => {
  const form = await fetch(`${sim.url}/portal/PBM_PORTAL/appeal`);
  expect(form.status).toBe(200);
  const markup = await form.text();
  expect(markup).toContain('name="wholesaler_attestation"');
  expect(markup).toContain('name="attachment"');

  const claimId = "RXS-PORTAL-DOOR-1";
  const submitted = await fetch(`${sim.url}/portal/PBM_PORTAL/appeal`, {
    method: "POST", body: formData(claimId, FULL_FIELDS), redirect: "manual",
  });
  expect(submitted.status).toBe(303);
  const location = submitted.headers.get("location");
  expect(location).toBeTruthy();
  const status = await fetch(new URL(location!, sim.url));
  expect(status.status).toBe(200);
  const page = await status.text();
  expect(page).toContain('data-status="APPROVED"');
  expect(page).toContain(`data-ticket="PRT-`);
  expect(page).toContain("MAC appeal approved");
});

test("email inbox denies a missing TN attestation and approves the same thread after refile", async () => {
  const claimId = "RXS-EMAIL-DOOR-1";
  const incomplete = { ...FULL_FIELDS };
  delete (incomplete as Partial<typeof FULL_FIELDS>).wholesaler_attestation;
  const post = async (body: string, inReplyTo: string | null) => fetch(`${sim.url}/inbox/PBM_EMAIL/messages`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      from: "appeals@ph-meadowbrook.example",
      to: "appeals@pbm-email.example",
      subject: `${inReplyTo ? "Re: " : ""}MAC appeal ${claimId}`,
      body,
      claim_id: claimId,
      in_reply_to: inReplyTo,
      attachments: [{ filename: "invoice.pdf", content_type: "application/pdf", content_base64: "JVBERi0xLjQ=" }],
    }),
  });

  const first = await post(emailBody(claimId, incomplete), null);
  expect(first.status).toBe(201);
  const threadId = (await first.json() as { thread_id: string }).thread_id;
  const denied = await fetch(`${sim.url}/inbox/PBM_EMAIL/replies/${threadId}`);
  const denial = await denied.json() as { body: string };
  expect(denial.body).toContain("Status: DENIED");
  expect(denial.body).toContain("Missing field: wholesaler_attestation");

  const refiled = await post(emailBody(claimId, FULL_FIELDS), threadId);
  expect(refiled.status).toBe(200);
  expect((await refiled.json() as { thread_id: string }).thread_id).toBe(threadId);
  const approved = await fetch(`${sim.url}/inbox/PBM_EMAIL/replies/${threadId}`);
  const approval = await approved.json() as { body: string };
  expect(approval.body).toContain("Status: APPROVED");
  expect(approval.body).toContain("Approved amount: $6.40");
});

test("fax return is a parseable PDF and PBM_FAX concedes only on the rebuttal round", async () => {
  const claimId = "RXS-FAX-DOOR-1";
  const sendFax = (ticketId?: string) => fetch(`${sim.url}/fax/PBM_FAX`, {
    method: "POST",
    headers: { "content-type": "application/pdf", "x-claim-id": claimId, ...(ticketId ? { "x-ticket-id": ticketId } : {}) },
    body: faxPdf(claimId, FULL_FIELDS),
  });

  const first = await sendFax();
  expect(first.status).toBe(201);
  const ticketId = (await first.json() as { ticket_id: string }).ticket_id;
  const denied = await fetch(`${sim.url}/fax/PBM_FAX/return/${ticketId}`);
  expect(denied.status).toBe(200);
  expect(denied.headers.get("content-type")).toContain("application/pdf");
  expect(pdfLines(new Uint8Array(await denied.arrayBuffer())).join("\n")).toContain("Status: DENIED");

  const refiled = await sendFax(ticketId);
  expect(refiled.status).toBe(200);
  expect((await refiled.json() as { ticket_id: string }).ticket_id).toBe(ticketId);
  const approved = await fetch(`${sim.url}/fax/PBM_FAX/return/${ticketId}`);
  const lines = pdfLines(new Uint8Array(await approved.arrayBuffer())).join("\n");
  expect(lines).toContain("Status: APPROVED");
  expect(lines).toContain("Approved amount: $6.40");
});

test("hold mode keeps a response pending until released, and release-all counts held tickets", async () => {
  process.env.PBM_SIM_HOLD = "1";
  process.env.PBM_SIM_HOLD_MAX_S = "60";
  try {
    const file = async (claimId: string) => {
      const r = await fetch(`${sim.url}/dev/appeals`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          claim_id: claimId, pbm: "PBM_PORTAL", state: "TN", delta: 6.4, fields: FULL_FIELDS, attachments: ["invoice.pdf"],
        }),
      });
      return (await r.json() as { ticket_id: string }).ticket_id;
    };
    const status = async (ticket: string) => (await (await fetch(`${sim.url}/dev/appeals/${ticket}`)).json() as { status: string }).status;

    const a = await file("RXS-HOLD-1");
    expect(await status(a)).toBe("PENDING");
    const released = await fetch(`${sim.url}/dev/appeals/${a}/release`, { method: "POST" });
    expect(await released.json()).toEqual({ released: true, ticket_id: a });
    expect(await status(a)).not.toBe("PENDING");
    const again = await fetch(`${sim.url}/dev/appeals/${a}/release`, { method: "POST" });
    expect((await again.json() as { released: boolean }).released).toBe(false);

    const b = await file("RXS-HOLD-2");
    const c = await file("RXS-HOLD-3");
    expect(await status(b)).toBe("PENDING");
    const all = await fetch(`${sim.url}/dev/appeals/release-all`, { method: "POST" });
    expect(((await all.json()) as { released: number }).released).toBeGreaterThanOrEqual(2);
    expect(await status(b)).not.toBe("PENDING");
    expect(await status(c)).not.toBe("PENDING");

    expect((await fetch(`${sim.url}/dev/appeals/NOPE-1/release`, { method: "POST" })).status).toBe(404);
  } finally {
    delete process.env.PBM_SIM_HOLD;
    delete process.env.PBM_SIM_HOLD_MAX_S;
  }
});

test("a held response auto-releases after the hold cap", async () => {
  process.env.PBM_SIM_HOLD = "1";
  process.env.PBM_SIM_HOLD_MAX_S = "0";
  try {
    const r = await fetch(`${sim.url}/dev/appeals`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        claim_id: "RXS-HOLD-4", pbm: "PBM_PORTAL", state: "TN", delta: 6.4, fields: FULL_FIELDS, attachments: ["invoice.pdf"],
      }),
    });
    const ticket = (await r.json() as { ticket_id: string }).ticket_id;
    const status = (await (await fetch(`${sim.url}/dev/appeals/${ticket}`)).json() as { status: string }).status;
    expect(status).not.toBe("PENDING");
  } finally {
    delete process.env.PBM_SIM_HOLD;
    delete process.env.PBM_SIM_HOLD_MAX_S;
  }
});
