import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { scanOpportunityCsv, type OpportunityScanResult, type ScanStatus } from "../src/opportunity-scan";

const NOW = new Date("2026-10-11T12:00:00Z");
const EXAMPLE_DIR = join(import.meta.dir, "../../dashboard/public");

type ExpectedExample = {
  file: string;
  statuses: ScanStatus[];
  summary: OpportunityScanResult["summary"];
};

const EXAMPLES: ExpectedExample[] = [
  {
    file: "sample-claims.csv",
    statuses: ["READY", "PAID_FAIRLY", "NEEDS_REVIEW", "EXPIRED", "MISSING_DATA", "READY", "READY", "PAID_FAIRLY", "READY", "READY"],
    summary: { claims_scanned: 10, underpaid_claims: 8, ready_claims: 5, needs_review_claims: 1, missing_data_claims: 1, expired_claims: 1, paid_fairly_claims: 2, total_shortfall: 73.25, ready_to_recover: 60.95, estimated_fee: 15.24, estimated_pharmacy_net: 45.71 },
  },
  {
    file: "sample-high-recovery.csv",
    statuses: ["READY", "READY", "READY", "READY", "READY", "READY"],
    summary: { claims_scanned: 6, underpaid_claims: 6, ready_claims: 6, needs_review_claims: 0, missing_data_claims: 0, expired_claims: 0, paid_fairly_claims: 0, total_shortfall: 290.5, ready_to_recover: 290.5, estimated_fee: 72.63, estimated_pharmacy_net: 217.87 },
  },
  {
    file: "sample-missing-evidence.csv",
    statuses: ["MISSING_DATA", "MISSING_DATA", "MISSING_DATA", "READY", "PAID_FAIRLY"],
    summary: { claims_scanned: 5, underpaid_claims: 4, ready_claims: 1, needs_review_claims: 0, missing_data_claims: 3, expired_claims: 0, paid_fairly_claims: 1, total_shortfall: 63, ready_to_recover: 9, estimated_fee: 2.25, estimated_pharmacy_net: 6.75 },
  },
  {
    file: "sample-deadline-risk.csv",
    statuses: ["READY", "READY", "READY", "EXPIRED", "EXPIRED", "PAID_FAIRLY"],
    summary: { claims_scanned: 6, underpaid_claims: 5, ready_claims: 3, needs_review_claims: 0, missing_data_claims: 0, expired_claims: 2, paid_fairly_claims: 1, total_shortfall: 87, ready_to_recover: 45, estimated_fee: 11.25, estimated_pharmacy_net: 33.75 },
  },
  {
    file: "sample-alternate-export.csv",
    statuses: ["READY", "READY", "NEEDS_REVIEW", "MISSING_DATA", "PAID_FAIRLY"],
    summary: { claims_scanned: 5, underpaid_claims: 4, ready_claims: 2, needs_review_claims: 1, missing_data_claims: 1, expired_claims: 0, paid_fairly_claims: 1, total_shortfall: 60.2, ready_to_recover: 30, estimated_fee: 7.5, estimated_pharmacy_net: 22.5 },
  },
];

const rounded = (value: number) => Math.round(value * 100) / 100;

async function readExample(file: string): Promise<string> {
  return Bun.file(join(EXAMPLE_DIR, file)).text();
}

describe("opportunity scan example regression suite", () => {
  for (const expected of EXAMPLES) {
    test(`${expected.file} has the reviewed row decisions and totals`, async () => {
      let modelCalls = 0;
      const result = await scanOpportunityCsv(await readExample(expected.file), {
        now: NOW,
        suggestHeaders: async () => {
          modelCalls++;
          return [];
        },
      });

      expect(modelCalls).toBe(0);
      expect(result.parser.mode).toBe("deterministic");
      expect(result.claims.map((claim) => claim.status)).toEqual(expected.statuses);
      expect(result.summary).toEqual(expected.summary);

      for (const claim of result.claims) {
        expect(claim.shortfall).toBe(rounded(Math.max(0, claim.acquisition_cost - claim.total_paid)));
        if (claim.status === "READY") {
          expect(claim.shortfall).toBeGreaterThan(0.5);
          expect(claim.invoice_number).not.toBeNull();
          expect(claim.invoice_date).not.toBeNull();
          expect(new Date(`${claim.appeal_deadline}T23:59:59Z`).getTime()).toBeGreaterThanOrEqual(NOW.getTime());
        }
      }

      const readyTotal = rounded(result.claims
        .filter((claim) => claim.status === "READY")
        .reduce((sum, claim) => sum + claim.shortfall, 0));
      expect(result.summary.ready_to_recover).toBe(readyTotal);
    });
  }

  test("changing row facts changes the decision instead of preserving a preset result", async () => {
    const original = await readExample("sample-claims.csv");

    const fairlyPaid = await scanOpportunityCsv(
      original.replace("NC,6.40,12.80,INV-1001", "NC,12.80,12.80,INV-1001"),
      { now: NOW },
    );
    expect(fairlyPaid.claims[0]).toMatchObject({ claim_id: "HIST-001", shortfall: 0, status: "PAID_FAIRLY" });
    expect(fairlyPaid.summary.ready_claims).toBe(4);

    const missingEvidence = await scanOpportunityCsv(
      original.replace("INV-1001,2026-09-01,2026-10-20", ",,2026-10-20"),
      { now: NOW },
    );
    expect(missingEvidence.claims[0]).toMatchObject({ claim_id: "HIST-001", shortfall: 6.4, status: "MISSING_DATA" });

    const expired = await scanOpportunityCsv(
      original.replace("INV-1001,2026-09-01,2026-10-20", "INV-1001,2026-09-01,2026-10-10"),
      { now: NOW },
    );
    expect(expired.claims[0]).toMatchObject({ claim_id: "HIST-001", shortfall: 6.4, status: "EXPIRED" });
  });
});
