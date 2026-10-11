import { createAppeal, decisionFor, isKnownPbm, normalizeFieldName, refileAppeal } from "./shared";

const threads = new Map<string, {
  pbm: string;
  claimId: string;
  subject: string;
  appeal: ReturnType<typeof createAppeal>;
  reply: { subject: string; body: string; received_at: string } | null;
}>();

const error = (message: string, status = 400) => Response.json({ error: message }, { status });

function parseMessage(body: string, expectedClaimId: string) {
  const fields: Record<string, unknown> = {};
  let claimId = "";
  let delta: number | null = null;
  for (const line of body.split(/\r?\n/)) {
    const separator = line.indexOf(":");
    if (separator < 1) continue;
    const key = normalizeFieldName(line.slice(0, separator));
    const value = line.slice(separator + 1).trim();
    if (key === "claim") claimId = value.split(/\s+/)[0] ?? "";
    else if (key === "amount_appealed") {
      const amount = Number(value.replace(/[$,\s]/g, ""));
      if (Number.isFinite(amount) && amount >= 0) delta = amount;
    } else if (key !== "attachments") {
      fields[key] = value;
    }
  }
  if (!claimId || claimId !== expectedClaimId) throw new Error("body Claim does not match claim_id");
  if (delta === null) throw new Error("body must include a non-negative Amount appealed");
  const state = String(fields.state ?? "").toUpperCase();
  if (!/^[A-Z]{2}$/.test(state)) throw new Error("body must include a two-letter state field");
  fields.state = state;
  return { fields, state, delta };
}

function replyBody(decision: NonNullable<ReturnType<typeof decisionFor>>, appealDelta: number): string {
  if (decision.status === "APPROVED") {
    return `Status: APPROVED\nApproved amount: $${(decision.delta ?? appealDelta).toFixed(2)}`;
  }
  const lines = ["Status: DENIED", `Reason: ${decision.reason ?? "insufficient_evidence"}`];
  if (decision.reason === "missing_field" && decision.field) lines.push(`Missing field: ${decision.field}`);
  return lines.join("\n");
}

export const inboxRoutes = {
  "/inbox/:pbm/messages": {
    POST: async (req: Bun.BunRequest<"/inbox/:pbm/messages">) => {
      const { pbm } = req.params;
      if (!isKnownPbm(pbm)) return error("unknown PBM", 404);

      let message: Record<string, unknown>;
      try {
        message = await req.json() as Record<string, unknown>;
      } catch {
        return error("expected JSON message body");
      }
      const claimId = typeof message.claim_id === "string" ? message.claim_id.trim() : "";
      const subject = typeof message.subject === "string" ? message.subject.trim() : "";
      const body = typeof message.body === "string" ? message.body : "";
      if (!claimId || !subject || !body) return error("claim_id, subject, and body are required");
      if (!Array.isArray(message.attachments) || message.attachments.some((attachment) =>
        !attachment || typeof attachment !== "object"
        || typeof (attachment as Record<string, unknown>).filename !== "string"
        || typeof (attachment as Record<string, unknown>).content_type !== "string"
        || typeof (attachment as Record<string, unknown>).content_base64 !== "string"
      )) return error("attachments must contain filename, content_type, and content_base64");

      let parsed: ReturnType<typeof parseMessage>;
      try {
        parsed = parseMessage(body, claimId);
      } catch (cause) {
        return error(cause instanceof Error ? cause.message : "invalid appeal body");
      }
      const attachmentNames = (message.attachments as Array<{ filename: string }>).map((file) => file.filename.split(/[\\/]/).pop() ?? file.filename);
      const parentId = typeof message.in_reply_to === "string" && message.in_reply_to.trim() ? message.in_reply_to.trim() : null;

      if (parentId) {
        const thread = threads.get(parentId);
        if (!thread || thread.pbm !== pbm || thread.claimId !== claimId) return error("unknown email thread", 404);
        const previous = decisionFor(thread.appeal);
        if (!previous) return error("appeal is still pending", 409);
        if (previous.status !== "DENIED") return error("only denied appeals accept a refile", 409);
        refileAppeal(thread.appeal, {
          state: parsed.state, fields: parsed.fields, attachments: attachmentNames, delta: parsed.delta,
        });
        thread.subject = subject;
        thread.reply = null;
        return Response.json({ thread_id: parentId, submitted_at: thread.appeal.submitted_at, expected_response_by: new Date(thread.appeal.decide_at).toISOString() });
      }

      const appeal = createAppeal({
        claim_id: claimId,
        pbm,
        state: parsed.state,
        channel: "email",
        fields: parsed.fields,
        attachments: attachmentNames,
        delta: parsed.delta,
      });
      threads.set(appeal.ticket_id, { pbm, claimId, subject, appeal, reply: null });
      return Response.json({ thread_id: appeal.ticket_id, submitted_at: appeal.submitted_at, expected_response_by: new Date(appeal.decide_at).toISOString() }, { status: 201 });
    },
  },
  "/inbox/:pbm/replies/:thread": {
    GET: (req: Bun.BunRequest<"/inbox/:pbm/replies/:thread">) => {
      const { pbm, thread: threadId } = req.params;
      if (!isKnownPbm(pbm)) return error("unknown PBM", 404);
      const thread = threads.get(threadId);
      if (!thread || thread.pbm !== pbm) return error("unknown email thread", 404);
      const decision = decisionFor(thread.appeal);
      if (!decision) return Response.json({ status: "PENDING" });
      thread.reply ??= {
        subject: `Re: ${thread.subject.replace(/^(?:re:\s*)+/i, "")}`,
        body: replyBody(decision, thread.appeal.delta),
        received_at: new Date().toISOString(),
      };
      return Response.json(thread.reply);
    },
  },
};
