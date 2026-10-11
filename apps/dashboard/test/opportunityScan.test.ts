import { expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { OpportunityScan } from "../components/scan/OpportunityScan";
import { PolicySetup } from "../components/scan/PolicySetup";
import {
  DEFAULT_AUTO_FILE_MAX,
  EXAMPLE_SCANS,
  MINIMUM_SCAN_DURATION_MS,
  parseAutoFileMax,
  previewPolicy,
  readyClaimIds,
  remainingScanDelay,
  reviewQueue,
  scanStatusPresentation,
  toggleSelected,
} from "../lib/opportunityScan";

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

test("scan feedback lasts long enough to be visible without delaying slow work", () => {
  expect(MINIMUM_SCAN_DURATION_MS).toBe(1_200);
  expect(remainingScanDelay(1_000, 1_500)).toBe(700);
  expect(remainingScanDelay(1_000, 2_500)).toBe(0);
});

test("scan intake offers five built-in scenarios directly with concise copy", () => {
  const html = renderToStaticMarkup(createElement(OpportunityScan));

  expect(EXAMPLE_SCANS).toHaveLength(5);
  expect(new Set(EXAMPLE_SCANS.map((example) => example.id)).size).toBe(5);
  expect(html.match(/<option/g)).toHaveLength(5);
  expect(html).toContain("Run example CSV");
  expect(html).toContain("Choose a CSV");
  expect(html.indexOf("Run example CSV")).toBeLessThan(html.indexOf("Choose a CSV"));
  expect(html).toContain('<button class="btn btn--ghost" type="button" aria-controls="scan-summary"');
  expect(html).toContain('<label class="btn scan-file">Choose a CSV');
  expect(html).not.toContain("Download the example CSV");
  expect(html).not.toContain("scan-privacy");
  expect(html).not.toContain("—");
});

// --- Review queue and policy setup -------------------------------------------------------------

const QUEUE_CLAIMS = [
  { claim_id: "A", drug: "Metformin", pbm: "PBM_PORTAL", status: "READY", shortfall: 6.4, reason: "" },
  { claim_id: "B", drug: "Lisinopril", pbm: "PBM_FAX", status: "NEEDS_REVIEW", shortfall: 0.3, reason: "" },
  { claim_id: "C", drug: "Insulin", pbm: "PBM_EMAIL", status: "READY", shortfall: 137.6, reason: "" },
  { claim_id: "D", drug: "Montelukast", pbm: "PBM_PORTAL", status: "MISSING_DATA", shortfall: 6, reason: "" },
  { claim_id: "E", drug: "Sertraline", pbm: "PBM_EMAIL", status: "EXPIRED", shortfall: 6, reason: "" },
  { claim_id: "F", drug: "Amlodipine", pbm: "PBM_EMAIL", status: "PAID_FAIRLY", shortfall: 0, reason: "" },
] as const;

test("the review queue combines ready and needs-review claims and nothing else", () => {
  expect(reviewQueue(QUEUE_CLAIMS).map((claim) => claim.claim_id)).toEqual(["A", "B", "C"]);
});

test("toggling a claim returns a new selection without changing the old one", () => {
  const before = ["A", "C"];

  expect(toggleSelected(before, "C")).toEqual(["A"]);
  expect(toggleSelected(before, "B")).toEqual(["A", "C", "B"]);
  expect(before).toEqual(["A", "C"]);
});

test("the auto-file limit accepts plain dollar amounts and rejects everything else", () => {
  expect(DEFAULT_AUTO_FILE_MAX).toBe(100);
  expect(parseAutoFileMax("100")).toBe(100);
  expect(parseAutoFileMax(" $25.50 ")).toBe(25.5);
  expect(parseAutoFileMax("0")).toBe(0);
  expect(parseAutoFileMax("")).toBeNull();
  expect(parseAutoFileMax("-5")).toBeNull();
  expect(parseAutoFileMax("abc")).toBeNull();
  expect(parseAutoFileMax("1e3")).toBeNull();
});

test("policy preview routes selected claims by the dollar limit and review status", () => {
  const preview = previewPolicy(QUEUE_CLAIMS, ["A", "B", "C"], 100);

  expect(preview.autoFile.map((claim) => claim.claim_id)).toEqual(["A"]);
  expect(preview.needsApproval.map((entry) => entry.claim.claim_id)).toEqual(["B", "C"]);
  expect(preview.needsApproval[0]!.why).toBe("Small shortfall needs pharmacist review");
  expect(preview.needsApproval[1]!.why).toBe("$137.60 is over the $100.00 auto-file limit");
  expect(preview.autoFileTotal).toBe(6.4);
  expect(preview.needsApprovalTotal).toBe(137.9);
  expect(preview.selectedTotal).toBe(144.3);
});

test("policy preview treats a shortfall equal to the limit as inside the policy", () => {
  // Mirrors apps/api/src/policy.ts, which blocks only when the delta is strictly over the limit.
  expect(previewPolicy(QUEUE_CLAIMS, ["A"], 6.4).autoFile).toHaveLength(1);
  expect(previewPolicy(QUEUE_CLAIMS, ["A"], 6.39).autoFile).toHaveLength(0);
});

test("policy preview ignores unselected claims and claims outside the review queue", () => {
  const preview = previewPolicy(QUEUE_CLAIMS, ["A", "D", "E", "F", "missing"], 100);

  expect(preview.autoFile.map((claim) => claim.claim_id)).toEqual(["A"]);
  expect(preview.needsApproval).toEqual([]);
  expect(preview.selectedTotal).toBe(6.4);
});

test("policy setup preselects ready claims and previews the default limit without filing", () => {
  const html = renderToStaticMarkup(createElement(PolicySetup, { claims: [...QUEUE_CLAIMS] }));

  expect(html.match(/type="checkbox"/g)).toHaveLength(3);
  expect(html.match(/checked=""/g)).toHaveLength(2);
  expect(html).toContain('value="100"');
  expect(html).toContain("<b>1 claim</b> would file automatically ($6.40)");
  expect(html).toContain("<b>1 claim</b> would wait for your approval ($137.60)");
  expect(html).toContain("Nothing is filed from this preview");
  expect(html).not.toContain("Montelukast");
  expect(html).not.toContain("—");
});
