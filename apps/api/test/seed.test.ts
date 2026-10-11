import { expect, test } from "bun:test";
import { seedClaims } from "../../../seed/expand";
import { macUnit, copay } from "../../pbm-sim/src/personas";
import { invoice } from "../src/reference";
import { MARGINAL_BAND } from "../src/agents/watcher";

const cents = (value: number) => Math.round(value * 100) / 100;

test("expanded seed is 60 unique opaque claims with 18 underwater, 39 clear, and 3 marginal", () => {
  expect(seedClaims).toHaveLength(60);
  expect(new Set(seedClaims.map((claim) => claim.claim_id)).size).toBe(60);
  expect(new Set(seedClaims.map((claim) => claim.meta.patient_ref)).size).toBe(60);
  expect(new Set(seedClaims.map((claim) => claim.meta.pbm))).toEqual(new Set(["PBM_PORTAL", "PBM_EMAIL", "PBM_FAX"]));
  expect(seedClaims.every((claim) => /^PT-[A-Z0-9-]+$/.test(claim.meta.patient_ref))).toBe(true);

  const counts = { UNDERWATER: 0, CLEAR: 0, MARGINAL: 0 };
  for (const claim of seedClaims) {
    const ndc = String(claim.request["407-D7"]);
    const qty = Number(claim.request["442-E7"]);
    const unit = macUnit(claim.meta.pbm, ndc);
    const invoiceLine = invoice(ndc);
    const acq = invoiceLine ? cents(invoiceLine.unit_cost * qty) : null;
    const paidUnitTotal = unit === undefined ? 0 : cents(unit * qty);
    const paid = cents(Math.max(paidUnitTotal - copay(claim.meta.plan), 0));
    const delta = acq === null ? 0 : cents(acq - paid);
    const verdict = delta <= 0 || acq === null ? "CLEAR" : delta <= MARGINAL_BAND ? "MARGINAL" : "UNDERWATER";
    counts[verdict]++;
  }
  expect(counts).toEqual({ UNDERWATER: 18, CLEAR: 39, MARGINAL: 3 });
});
