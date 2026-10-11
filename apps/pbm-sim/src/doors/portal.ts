import { appeals } from "../store";
import { persona, requiredFields } from "../personas";
import { createAppeal, decisionFor, escapeHtml, isKnownPbm, refileAppeal } from "./shared";

const html = (body: string) => new Response(`<!doctype html><html lang="en"><head><meta charset="utf-8"><title>PBM Appeals Portal</title></head><body>${body}</body></html>`, {
  headers: { "content-type": "text/html; charset=utf-8" },
});
const error = (message: string, status = 400) => Response.json({ error: message }, { status });
const missing = () => error("unknown appeal", 404);

function appealFields(pbm: string, state = "TN"): string[] {
  return [...new Set([...requiredFields(pbm, state), "claim_id", "state", "delta", "statute"])];
}

function form(pbm: string, state = "TN", action = `/portal/${encodeURIComponent(pbm)}/appeal`): string {
  const fields = appealFields(pbm, state);
  const standard: Record<string, string> = { state, claim_id: "", delta: "", statute: "" };
  const inputs = fields.map((name) => {
    const label = name.replaceAll("_", " ");
    return `<label>${escapeHtml(label)}<input name="${escapeHtml(name)}" type="text" value="${escapeHtml(standard[name] ?? "")}"></label>`;
  }).join("");
  return `<main><h1>${escapeHtml(persona(pbm).display_name)} Appeals</h1><form method="post" action="${escapeHtml(action)}" enctype="multipart/form-data">${inputs}<label>Supporting documents<input type="file" name="attachment" multiple></label><button type="submit">Submit appeal</button></form></main>`;
}

function statusPage(pbm: string, ticket: string): Response {
  const appeal = appeals.get(ticket);
  if (!appeal || appeal.pbm !== pbm || appeal.channel !== "portal") return missing();
  const decision = decisionFor(appeal);
  const status = decision?.status ?? "PENDING";
  const reason = decision?.reason ?? "";
  const field = decision?.field ?? "";
  const delta = decision?.delta == null ? "" : String(decision.delta);
  const message = decision?.message ?? "Your appeal has been received and is pending review.";
  const replyForm = decision?.status === "DENIED"
    ? form(pbm, appeal.state, `/portal/${encodeURIComponent(pbm)}/status/${encodeURIComponent(ticket)}/reply`)
    : "";
  return html(`<main><h1>Appeal status</h1><div id="status" data-ticket="${escapeHtml(ticket)}" data-status="${status}" data-submitted-at="${escapeHtml(appeal.submitted_at)}" data-expected-by="${escapeHtml(new Date(appeal.decide_at).toISOString())}" data-reason="${escapeHtml(reason)}" data-field="${escapeHtml(field)}" data-delta="${escapeHtml(delta)}"></div><p id="message">${escapeHtml(message)}</p><p>Claim ${escapeHtml(appeal.claim_id)} · ${escapeHtml(pbm)}</p>${replyForm}</main>`);
}

async function readForm(req: Request) {
  let data: Awaited<ReturnType<typeof req.formData>>;
  try {
    data = await req.formData();
  } catch {
    return { error: "expected multipart form data" } as const;
  }
  const fields: Record<string, unknown> = {};
  const attachments: string[] = [];
  for (const [key, value] of data.entries()) {
    if (key === "attachment" && typeof value !== "string") {
      attachments.push(value.name.split(/[\\/]/).pop() ?? value.name);
    } else if (typeof value === "string") {
      fields[key] = value;
    }
  }
  const claimId = String(fields.claim_id ?? "").trim();
  const state = String(fields.state ?? "").trim().toUpperCase();
  const delta = Number(fields.delta);
  if (!claimId || !/^[A-Z]{2}$/.test(state) || !Number.isFinite(delta) || delta < 0)
    return { error: "claim_id, two-letter state, and non-negative delta are required" } as const;
  return { fields, attachments, claimId, state, delta } as const;
}

const redirectToStatus = (pbm: string, ticket: string) => new Response(null, {
  status: 303,
  headers: { location: `/portal/${encodeURIComponent(pbm)}/status/${encodeURIComponent(ticket)}` },
});

export const portalRoutes = {
  "/portal/:pbm/appeal": {
    GET: (req: Bun.BunRequest<"/portal/:pbm/appeal">) => {
      const { pbm } = req.params;
      if (!isKnownPbm(pbm)) return error("unknown PBM", 404);
      const state = new URL(req.url).searchParams.get("state")?.toUpperCase() ?? "TN";
      return html(form(pbm, /^[A-Z]{2}$/.test(state) ? state : "TN"));
    },
    POST: async (req: Bun.BunRequest<"/portal/:pbm/appeal">) => {
      const { pbm } = req.params;
      if (!isKnownPbm(pbm)) return error("unknown PBM", 404);
      const submission = await readForm(req);
      if ("error" in submission && typeof submission.error === "string") return error(submission.error);
      const appeal = createAppeal({
        claim_id: submission.claimId,
        pbm,
        state: submission.state,
        channel: "portal",
        fields: submission.fields,
        attachments: submission.attachments,
        delta: submission.delta,
      });
      return redirectToStatus(pbm, appeal.ticket_id);
    },
  },
  "/portal/:pbm/status/:ticket": {
    GET: (req: Bun.BunRequest<"/portal/:pbm/status/:ticket">) => {
      const { pbm, ticket } = req.params;
      if (!isKnownPbm(pbm)) return error("unknown PBM", 404);
      return statusPage(pbm, ticket);
    },
  },
  "/portal/:pbm/status/:ticket/reply": {
    POST: async (req: Bun.BunRequest<"/portal/:pbm/status/:ticket/reply">) => {
      const { pbm, ticket } = req.params;
      if (!isKnownPbm(pbm)) return error("unknown PBM", 404);
      const appeal = appeals.get(ticket);
      if (!appeal || appeal.pbm !== pbm || appeal.channel !== "portal") return missing();
      const decision = decisionFor(appeal);
      if (!decision) return error("appeal is still pending", 409);
      if (decision.status !== "DENIED") return error("only denied appeals accept a reply", 409);
      const submission = await readForm(req);
      if ("error" in submission && typeof submission.error === "string") return error(submission.error);
      if (submission.claimId !== appeal.claim_id) return error("claim_id does not match this appeal", 400);
      refileAppeal(appeal, {
        state: submission.state,
        fields: submission.fields,
        attachments: submission.attachments,
        delta: submission.delta,
      });
      return redirectToStatus(pbm, ticket);
    },
  },
};
