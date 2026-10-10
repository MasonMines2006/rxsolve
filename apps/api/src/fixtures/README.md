# Reference data (agent side)

What RxSolve knows, as opposed to what the PBM Sim knows (`apps/pbm-sim/data/`). The two are
deliberately separate: our spec of a PBM can be wrong; the PBM Sim is the ground truth.

| File | Owner | Contents |
|---|---|---|
| `specs.json` | P2 (RES-01) | Our versioned model of each PBM's appeal spec: channel, required fields, source URL |
| `statutes.json` | P2 (RES-01) | Per-state citation, entitlement text, appeal window in business days, regulator |
| `invoices.json` | P1 | Wholesaler invoice lines (X12 810-style) keyed by NDC; `unit_cost` is per unit dispensed |
| `nadac.json` | P1 | NADAC per-unit fixture (no real NADAC API) |
| `contracts.json` | P1 | Contract rate per unit, keyed `"<plan>|<ndc>"` |
| `drugs.json` | P3 | Display names for NDCs on the dashboard and cashier terminal |

Values marked `TODO(RES-01)` are placeholders until the research ticket lands.
