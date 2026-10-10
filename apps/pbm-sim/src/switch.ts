/**
 * Claim switch (DESIGN.md 8.2, INF-03). Owner: P1.
 *
 * POST /switch/claim
 *   {"transaction": "B1", "meta": {claim_id?, pbm, pharmacy_id, state, plan, patient_ref},
 *    "request": {"401-D1"?: "YYYYMMDD", "402-D2", "407-D7", "442-E7", "405-D5", "409-D9", "426-DQ"}}
 * -> {"transaction", "request", "response"} with the NCPDP-shaped response. Paid claims are teed to
 * CLAIM_FEED_URL (the RxSolve API), the way a switch vendor shares adjudication data.
 */
import { claims } from "./store";
import { copay, macUnit } from "./personas";

type SwitchBody = { transaction?: string; meta: Record<string, string>; request: Record<string, string | number> };

const feedUrl = () => process.env.CLAIM_FEED_URL ?? "http://localhost:8000/api/feed/claim";
const today = () => new Date().toISOString().slice(0, 10).replaceAll("-", "");

export function adjudicate(pbm: string, plan: string, req: Record<string, string | number>) {
  const unit = macUnit(pbm, String(req["407-D7"]));
  if (unit === undefined) return { "112-AN": "R", "506-F6": null, "505-F5": null, "509-F9": null, "511-FB": "70" }; // 70: product not covered
  const ingredient = Math.round(unit * Number(req["442-E7"]) * 100) / 100;
  const patientPay = Math.min(copay(plan), ingredient);
  return { "112-AN": "P", "506-F6": ingredient, "505-F5": patientPay, "509-F9": Math.round((ingredient - patientPay) * 100) / 100, "511-FB": null };
}

export async function switchClaim(req: Request): Promise<Response> {
  const body = (await req.json()) as SwitchBody;
  const transaction = body.transaction ?? "B1";
  const request = { "401-D1": today(), ...body.request };
  if (transaction !== "B1")
    return Response.json({ transaction, request, response: { "112-AN": "R", "511-FB": "TODO B2/B3" } });
  const ncpdp = { transaction, request, response: adjudicate(body.meta.pbm!, body.meta.plan!, request) };
  claims.push({ meta: body.meta, ...ncpdp });
  if (ncpdp.response["112-AN"] === "P") {
    fetch(feedUrl(), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ meta: body.meta, ncpdp }) })
      .catch((e) => console.warn(`claim feed unreachable (${feedUrl()}): ${e}`));
  }
  return Response.json(ncpdp);
}
