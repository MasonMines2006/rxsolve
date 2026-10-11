import { appeals } from "../store";
import { createAppeal, decisionFor, isKnownPbm, refileAppeal } from "./shared";

const error = (message: string, status = 400) => Response.json({ error: message }, { status });
const text = (bytes: Uint8Array) => new TextDecoder("latin1").decode(bytes);

function pdfLines(bytes: Uint8Array): string[] {
  const source = text(bytes);
  return [...source.matchAll(/\(((?:\\.|[^\\)])*)\)\s*(?:'|Tj)/g)]
    .map((match) => match[1]!.replace(/\\([\\()])/g, "$1"));
}

function parseCover(bytes: Uint8Array, expectedClaimId: string) {
  const lines = pdfLines(bytes);
  const claimLine = lines.find((line) => line.startsWith("Claim:"));
  const claimId = claimLine?.match(/^Claim:\s*(\S+)/)?.[1] ?? "";
  if (!claimId || claimId !== expectedClaimId) throw new Error("PDF claim does not match x-claim-id");

  const amountLine = lines.find((line) => /^Amount appealed:/i.test(line));
  const amount = amountLine?.match(/\$\s*([\d,]+(?:\.\d{1,2})?)/)?.[1];
  const delta = amount ? Number(amount.replace(/,/g, "")) : Number.NaN;
  if (!Number.isFinite(delta) || delta < 0) throw new Error("PDF must include a non-negative Amount appealed");

  const start = lines.findIndex((line) => line.trim() === "REQUIRED FIELDS");
  if (start < 0) throw new Error("PDF is missing REQUIRED FIELDS section");
  const fields: Record<string, unknown> = {};
  let attachmentLine = "";
  for (const line of lines.slice(start + 1)) {
    if (/^Attachments:/i.test(line)) {
      attachmentLine = line.replace(/^Attachments:\s*/i, "");
      break;
    }
    const separator = line.indexOf(":");
    if (separator < 1) continue;
    const key = line.slice(0, separator).trim().toLowerCase().replace(/[\s-]+/g, "_");
    fields[key] = line.slice(separator + 1).trim();
  }
  const stateFromHeader = claimLine?.match(/\bState:\s*([A-Z]{2})\b/)?.[1];
  const state = String(fields.state ?? stateFromHeader ?? "").toUpperCase();
  if (!/^[A-Z]{2}$/.test(state)) throw new Error("PDF must include a two-letter state field");
  fields.state = state;
  const attachments = attachmentLine && attachmentLine.toLowerCase() !== "none"
    ? attachmentLine.split(",").map((name) => name.trim().split(/[\\/]/).pop() ?? name.trim()).filter(Boolean)
    : [];
  return { fields, state, delta, attachments };
}

const escapePdf = (value: string) => value.replace(/[^\x20-\x7e]/g, "?").replace(/([\\()])/g, "\\$1");

function replyPdf(lines: string[]): Uint8Array {
  const wrapped = lines.flatMap((line) => {
    const out: string[] = [];
    let current = "";
    for (const word of line.split(/\s+/)) {
      if (current && current.length + word.length + 1 > 88) {
        out.push(current);
        current = word;
      } else current = current ? `${current} ${word}` : word;
    }
    out.push(current);
    return out;
  });
  const content = ["BT", "/F1 10 Tf", "13 TL", "50 750 Td", ...wrapped.map((line) => `(${escapePdf(line)}) '`), "ET"].join("\n");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [4 0 R] /Count 1 >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents 5 0 R >>",
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    "<< /Title (PBM Fax Reply) /Producer (PBM Sim) >>",
  ];
  let output = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(output.length);
    output += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = output.length;
  output += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) output += `${String(offset).padStart(10, "0")} 00000 n \n`;
  output += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R /Info 6 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(output);
}

function decisionPdf(ticket: string, decision: NonNullable<ReturnType<typeof decisionFor>>): Uint8Array {
  const lines = ["PBM FAX RETURN", `Ticket: ${ticket}`, `Status: ${decision.status}`, decision.message];
  if (decision.status === "APPROVED" && decision.delta != null) lines.push(`Approved amount: $${decision.delta.toFixed(2)}`);
  if (decision.reason) lines.push(`Reason: ${decision.reason}`);
  if (decision.field) lines.push(`Missing field: ${decision.field}`);
  return replyPdf(lines);
}

export const faxRoutes = {
  "/fax/:pbm": {
    POST: async (req: Bun.BunRequest<"/fax/:pbm">) => {
      const { pbm } = req.params;
      if (!isKnownPbm(pbm)) return error("unknown PBM", 404);
      if (!(req.headers.get("content-type") ?? "").toLowerCase().includes("application/pdf"))
        return error("fax body must be application/pdf", 415);
      const claimId = req.headers.get("x-claim-id")?.trim() ?? "";
      if (!claimId) return error("x-claim-id is required");
      let parsed: ReturnType<typeof parseCover>;
      try {
        parsed = parseCover(new Uint8Array(await req.arrayBuffer()), claimId);
      } catch (cause) {
        return error(cause instanceof Error ? cause.message : "invalid fax PDF");
      }

      const ticketId = req.headers.get("x-ticket-id")?.trim();
      if (ticketId) {
        const appeal = appeals.get(ticketId);
        if (!appeal || appeal.pbm !== pbm || appeal.claim_id !== claimId || appeal.channel !== "fax") return error("unknown fax ticket", 404);
        const previous = decisionFor(appeal);
        if (!previous) return error("appeal is still pending", 409);
        if (previous.status !== "DENIED") return error("only denied appeals accept a refile", 409);
        refileAppeal(appeal, parsed);
        return Response.json({ ticket_id: ticketId, submitted_at: appeal.submitted_at, expected_response_by: new Date(appeal.decide_at).toISOString() });
      }

      const appeal = createAppeal({ claim_id: claimId, pbm, channel: "fax", ...parsed });
      return Response.json({ ticket_id: appeal.ticket_id, submitted_at: appeal.submitted_at, expected_response_by: new Date(appeal.decide_at).toISOString() }, { status: 201 });
    },
  },
  "/fax/:pbm/return/:ticket": {
    GET: (req: Bun.BunRequest<"/fax/:pbm/return/:ticket">) => {
      const { pbm, ticket } = req.params;
      if (!isKnownPbm(pbm)) return error("unknown PBM", 404);
      const appeal = appeals.get(ticket);
      if (!appeal || appeal.pbm !== pbm || appeal.channel !== "fax") return error("unknown fax ticket", 404);
      const decision = decisionFor(appeal);
      if (!decision) return new Response(null, { status: 202 });
      return new Response(decisionPdf(ticket, decision), { headers: { "content-type": "application/pdf" } });
    },
  },
};
