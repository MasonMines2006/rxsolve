import { expect, test } from "bun:test";
import { readyClaimIds, scanStatusPresentation } from "../lib/opportunityScan";

test("scan statuses have plain-language labels and semantic tones", () => {
  expect(scanStatusPresentation("READY")).toEqual({ label: "Ready for RxSolve", tone: "good" });
  expect(scanStatusPresentation("PAID_FAIRLY")).toEqual({ label: "Paid fairly", tone: "muted" });
  expect(scanStatusPresentation("NEEDS_REVIEW")).toEqual({ label: "Needs review", tone: "warn" });
  expect(scanStatusPresentation("MISSING_DATA")).toEqual({ label: "Missing evidence", tone: "warn" });
  expect(scanStatusPresentation("EXPIRED")).toEqual({ label: "Deadline expired", tone: "bad" });
});

test("only ready claims are staged for the next RxSolve step", () => {
  expect(readyClaimIds([
    { claim_id: "A", status: "READY" },
    { claim_id: "B", status: "NEEDS_REVIEW" },
    { claim_id: "C", status: "READY" },
    { claim_id: "D", status: "MISSING_DATA" },
  ])).toEqual(["A", "C"]);
});
