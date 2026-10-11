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
