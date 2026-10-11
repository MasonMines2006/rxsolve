import { expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { OpportunityScan } from "../components/scan/OpportunityScan";
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

test("scan intake offers the built-in example directly with concise copy", () => {
  const html = renderToStaticMarkup(createElement(OpportunityScan));

  expect(html).toContain("Use example CSV");
  expect(html).toContain("Choose a CSV");
  expect(html.indexOf("Use example CSV")).toBeLessThan(html.indexOf("Choose a CSV"));
  expect(html).not.toContain("Download the example CSV");
  expect(html).not.toContain("scan-privacy");
  expect(html).not.toContain("—");
});
