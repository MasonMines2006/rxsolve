# RxSolve

A payments processor for pharmacies: every prescription claim resolves at or above acquisition cost. Underpaid claims are caught at the point of sale, proven with the pharmacy's own invoice, appealed through whichever channel the PBM accepts (portal, email or fax), and settled on a real ledger.

Design and plan: [`docs/`](docs/) ([DESIGN](docs/DESIGN.md), [BUILD_PLAN](docs/BUILD_PLAN.md), [TICKETS](docs/TICKETS.md), [DEMO](docs/DEMO.md), [STATUS](docs/STATUS.md)).

## Run it

Needs [Bun](https://bun.sh) ≥ 1.3 (`brew install oven-sh/bun/bun`).

```sh
bun install
cp .env.example .env     # empty values are fine: everything falls back to local doubles
bun run dev              # api :8000, pbm-sim :8100, dashboard :3000
bun seed                 # replay the seed claims through the PBM Sim switch
open http://localhost:3000
```

Or one process per terminal: `bun api`, `bun sim`, `bun dash`. Then `bun seed RXS-0001` runs just the demo beat (portal claim, TN attestation denial, wholesaler remediation, refile, settlement).

`bun test` runs the demo path end to end over real HTTP. `bun run typecheck` checks every workspace.

## Layout and ownership

| Path | Owner | What |
|---|---|---|
| `packages/contracts/` | shared | Zod schemas and types for DESIGN §5.3 and every `/ws/live` event. Changing one means a line in `docs/DECISIONS.md`. |
| `apps/api/src/` (orchestrator, intake, ledger/, db, events, routes/core) | P1 | Agent runtime spine, Nessie ledger, deadline clock, standing-authorization gate |
| `apps/api/src/agents/`, `adapters/`, `messaging/`, `voice.ts`, `routes/messaging.ts` | P2 | Watcher, Evidence Builder, negotiation, channel adapters, Spectrum, ElevenLabs |
| `apps/api/src/fixtures/` | P1 / P2 | Reference data; per-file owners in its README |
| `apps/pbm-sim/` | P1 | Standalone mock PBMs: claim switch, decision engine, portal/inbox/fax doors. Imports nothing from `@rxsolve/*`. |
| `apps/dashboard/` | P3 | Next.js dashboard, PMS mock cashier terminal, pharmacist phone, themes |
| `seed/`, `scripts/` | P1 / P3 | Seed claims and the seed/probe scripts |
| `tools/agent-coordinator/` | dev tooling | Agent-to-agent mailbox; not part of the product |

## How a claim flows

```
cashier (dashboard) --B1--> pbm-sim /switch/claim --tee--> api /api/feed/claim
  -> orchestrator: watcher -> evidence -> policy gate -> adapter (PBM's door)
  -> pbm-sim decides (deterministic) -> negotiation on denial -> settlement on approval
  -> every step is an event on ws://localhost:8000/ws/live -> dashboard
```

## What is real and what is mocked

| Integration | Status |
|---|---|
| PBMs (portal, email, fax) | Mocked by design in `apps/pbm-sim`, modeled on public CVS Caremark, Express Scripts and OptumRx appeal procedures. No real logos. |
| Fax transport | Mocked inside the PBM Sim |
| Nessie | Local ledger double until INF-04 (`LEDGER_BACKEND=nessie`) |
| Photon Spectrum (iMessage) | Live when `PHOTON_PROJECT_ID`/`PHOTON_PROJECT_SECRET` are set; otherwise the dashboard phone mock shows every message |
| WhatsApp to wholesaler | Stubbed: the wholesaler replies instantly in the channel viewer |
| ElevenLabs | Live when keys are set; otherwise the digest goes without the voice recap |
| Real-PBM adapters | `ADAPTER_MODE=direct` files through the PBM Sim's JSON dev door until the portal/email/fax adapters land |

Current status of each stub is in [docs/STATUS.md](docs/STATUS.md).

## Photon setup

The Spectrum wiring follows Photon's "send your first message" scaffold: put the project's `PROJECT_ID` and `PROJECT_SECRET` in `.env` as `PHOTON_PROJECT_ID` and `PHOTON_PROJECT_SECRET`. On Free and Pro plans the shared iMessage line only reaches phones registered as project users in the Photon dashboard, so add the pharmacist's phone there. Agents get the SDK reference from `.claude/skills/spectrum/`.
