/**
 * Replay seed/claims.json through the PBM Sim switch, which tees each paid claim to the API.
 *   bun seed              # all claims
 *   bun seed RXS-0001     # one claim (the demo beat)
 * Needs `bun sim` and `bun api` running.
 */
import { seedClaims } from "../seed/expand";

const SIM = process.env.PBM_SIM_URL ?? "http://localhost:8100";
const only = new Set(process.argv.slice(2));

for (const c of seedClaims) {
  if (only.size && !only.has(c.claim_id)) continue;
  const r = await fetch(`${SIM}/switch/claim`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ transaction: "B1", meta: { claim_id: c.claim_id, ...c.meta }, request: c.request }),
  });
  const { response } = (await r.json()) as { response: Record<string, unknown> };
  console.log(`${c.claim_id}  paid ${String(response["509-F9"]).padStart(7)}  expect ${c.expect}`);
}
