# Opportunity scan TDD evidence

Date: 2026-10-11

## Behavior under test

- Parse a pharmacy claims CSV and calculate acquisition-cost shortfalls.
- Triage each row into ready, review, missing evidence, expired, or paid fairly.
- Stage only ready claim IDs; never persist the upload or file an appeal.
- Allow an optional model to map unknown header names only, within a fixed schema.
- Reject malformed amounts, impossible dates, invented headers, and ambiguous mappings.

## RED

The API behavior test was written and committed before the scanner existed:

```text
bun test apps/api/test/opportunity-scan.test.ts
error: Cannot find module '../src/opportunity-scan'
```

The dashboard behavior test was also written and committed before its helper existed:

```text
bun test apps/dashboard/test/opportunityScan.test.ts
error: Cannot find module '../lib/opportunityScan'
```

Checkpoint commits: `43f8d57` and `6f7e876`.

Two hardening tests were then observed failing against the first implementation: one source header could be reused for two targets, and JavaScript date normalization accepted `2026-02-31`.

## GREEN

Focused behavior suite:

```text
bun test apps/api/test/opportunity-scan.test.ts apps/dashboard/test/opportunityScan.test.ts
10 pass, 0 fail, 25 expect() calls
```

Full repository suite after hardening:

```text
bun test
155 pass, 0 fail, 780 expect() calls, 25 files
```

All four workspaces passed type checking: contracts, PBM Sim, dashboard, and API.

Focused coverage after hardening was 93.18% line coverage for `apps/api/src/opportunity-scan.ts` and 100% for `apps/dashboard/lib/opportunityScan.ts`.

## Browser verification

- Loaded `/scan` without console warnings or errors.
- Example data produced 10 scanned, 8 underpaid, 5 ready, and $60.95 ready to recover.
- Staging changed only local preview state and selected the five `READY` claims.
- Responsive table and the Frutiger Aero and dark themes were visually inspected.
- No screenshot baseline exists, so automated visual-regression comparison is inconclusive.

## Intake copy and control follow-up

On 2026-10-11, a follow-up journey required the scan to offer the bundled example directly, center the custom file control, remove the download and helper note, and use simpler copy without em dashes.

RED was captured in commit `416f69f`. Server-rendering `OpportunityScan` failed because the page still contained “Analyze example claims,” the download link, `scan-privacy`, and an em dash.

GREEN was captured in commit `1e8b9c3`:

```text
bun test apps/dashboard/test/opportunityScan.test.ts
3 pass, 0 fail, 12 expect() calls
```

The focused coverage run passed with 81.61% aggregate line coverage across the rendered component, panel, and scan helper. The complete repository then passed with 156 tests and 786 assertions, and all four workspaces passed type checking.

Browser QA confirmed that both controls are centered, **Use example CSV** loads the ten bundled claims directly, the revised page has no browser warnings or errors, and the main dashboard shows all 60 synthetic feed claims after reseeding. The home page appeared empty because the API uses in-memory storage by default and its development restart cleared the previous seed; no example fixture was removed from the repository.

## Example result visibility follow-up

A second follow-up found that the example request completed, but its results opened below the mobile viewport, making the button appear inactive. RED commit `fd50d11` defined the intended action hierarchy and result target. GREEN commit `ba9bc1d` makes **Choose a CSV** the primary control, marks the example button as controlling `scan-summary`, and scrolls the completed summary into view.

The focused suite passed with 3 tests and 14 assertions at 82.47% aggregate line coverage. Browser QA clicked the example from a fresh page and landed on the $60.95 recovery summary with no console warnings or errors. The complete repository passed with 156 tests and 788 assertions, and all four workspaces passed type checking.

## Selectable scenarios and progress follow-up

The scan now offers five synthetic examples: mixed outcomes, high recovery, missing evidence, deadline risk, and alternate column names. Each remains a real CSV passed through the same API as a user upload. No scenario contains preset result totals.

RED commits `dda7fbd` and `da255a7` defined five unique selectable examples and a 1.2-second minimum feedback window. GREEN commit `29dc6e5` added the files, selector, and animated progress bar. The minimum is skipped when real processing already takes longer.

Validation results:

- All five CSVs parsed successfully through `scanOpportunityCsv` and produced distinct calculated summaries.
- The focused dashboard suite passed 4 tests and 20 assertions at 83.90% aggregate line coverage.
- The full repository passed 157 tests and 794 assertions.
- All four workspaces passed type checking.
- Browser QA selected and ran the high-recovery example, showed the progress state, then calculated $290.50 ready to recover across six claims. No browser warnings or errors were recorded.

## Deterministic example regression suite

`apps/api/test/opportunity-scan-examples.test.ts` locks all five example CSVs to reviewed expected results. The suite checks every row's exact status, recalculates each shortfall from acquisition cost and total paid, checks the complete summary totals, and verifies every ready claim has its required evidence and an open deadline.

The tests also assert that the optional header-mapping model is called zero times for every bundled example. These results therefore come from the scanner's deterministic rules, not generated predictions.

A mutation regression test changes the facts on the same claim without changing its ID:

- Paying the full acquisition cost changes it from ready to paid fairly.
- Removing invoice evidence changes it to missing data while preserving its shortfall.
- Moving its deadline into the past changes it to expired while preserving its shortfall.

Validation results:

- The new suite passed 6 tests with 129 assertions.
- Combined scanner tests passed 14 tests with 148 assertions.
- `apps/api/src/opportunity-scan.ts` reached 96.43% function coverage and 93.18% line coverage.
- The full repository passed 163 tests with 923 assertions across 26 files.
- All four workspaces passed type checking.

This evidence proves the implementation follows the documented rules and responds to input changes. It does not prove those rules are sufficient for every real PBM contract or jurisdiction; that policy should be reviewed with a pharmacy reimbursement specialist before production use.
