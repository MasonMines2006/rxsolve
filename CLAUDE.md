# RxSolve

Payments processor for pharmacies that recovers underpaid prescription claims (paid below acquisition cost) in-flight and settles the recovery on a real ledger. Built for HackNC / MLH sponsor challenges (Photon Spectrum, Capital One Nessie, ElevenLabs).

## Docs

Design lives in `docs/`. These are living files; see "Living docs" below.

- `docs/DESIGN.md`: problem, scope, components, architecture, flows, data contracts, agents, ledger, trust & safety
- `docs/BUILD_PLAN.md`: team roles, build order, sync checkpoints, kill-switches, shared `.env`
- `docs/TICKETS.md`: INF-*, AGT-*, UI-* tickets per phase (P1/P2/P3)
- `docs/DEMO.md`: scripted demo beat, prize mapping, submission assets
- `docs/DECISIONS.md`: running log of decisions and contract changes
- `docs/STATUS.md`: ticket status, stubbed integrations, blockers

## Stack

TypeScript on Bun (one workspace monorepo), MongoDB Atlas (in-memory fallback), Capital One Nessie (ledger), Photon Spectrum (`spectrum-ts`, in-process) for iMessage/WhatsApp, ElevenLabs STT/TTS, Next.js + WebSocket dashboard, Claude (`claude-opus-5-5`) as the agent model.

| Path | Owner |
|---|---|
| `packages/contracts/` | shared: DESIGN 5.3 shapes and `/ws/live` events (zod + types) |
| `apps/api/` | P1: orchestrator, intake, ledger, db, events, `routes/core.ts`. P2: `agents/`, `adapters/`, `messaging/`, `voice.ts`, `routes/messaging.ts` |
| `apps/pbm-sim/` | P1: standalone mock PBMs; must import nothing from `@rxsolve/*` |
| `apps/dashboard/` | P3: dashboard, PMS mock cashier, pharmacist phone, themes |

## Commands

- `bun install`, then `bun run dev` (api :8000, pbm-sim :8100, dashboard :3000), `bun seed [RXS-0001]`.
- `bun test` runs the demo path end to end over real HTTP; `bun run typecheck` checks every workspace. Both must pass before pushing.
- Every app reads the one root `.env`. Empty values fall back to local doubles (in-memory db, local ledger, dashboard phone mock).
- Spectrum SDK reference for agents: `.claude/skills/spectrum/` (vendored from Photon's scaffold).

## Git rhythm

- Commit small and often, one logical change per commit.
- Pull/rebase before starting work and before pushing.
- Work on `main`. Stay in your phase's files (see the Stack table) to avoid conflicts.
- Never force-push. After the T+11 code freeze, nobody touches `main`.
- Never commit secrets. `.env` is gitignored; only `.env.example` is committed.

## Living docs

- `docs/` is the source of truth. Change code and the doc that describes it in the same commit.
- If code and docs contradict, resolve it immediately: fix the doc, or fix the code and record why.
- Record every decision or contract change as one line in `docs/DECISIONS.md` (date, decision, why).
- Record stubs, blockers, and ticket progress in `docs/STATUS.md`. Mark tickets done when their "Done when" is met.
- Team knowledge goes in `docs/` or this file, not in per-machine agent memory (memory is not shared across teammates).

## Shared contracts

- The JSON shapes in `DESIGN.md` section 5.3 and the `/ws/live` event shapes are interfaces between phases. Both live in code in `packages/contracts/src/index.ts`; the API and dashboard import them, so a breaking change fails typecheck wherever it matters.
- Changing one means logging it in `DECISIONS.md` and saying so in the commit message.
- Agents reach the PBM Sim over HTTP only (the dev door, then portal/inbox/fax). The PBM Sim never imports agent code (`apps/api/test/boundaries.test.ts`).

## Rules that must hold

- The mock PBM's concession is deterministic and rule-based; no model decides whether to concede.
- Watcher is deterministic on CLEAR/UNDERWATER; models only run on MARGINAL, evidence extraction, and negotiation.
- No real PHI; claims carry an opaque `patient_ref`.
- The ledger is append-only; corrections post reversing entries.
- Never file an appeal with incomplete evidence; abandon and log instead.
- If a sponsor API is dead, stub it and record the stub in `docs/STATUS.md` and the README; never halt the demo path.
- Anything not on the four-minute demo path gets cut (T+10 rule).
- Do not add or rename components from the docs without recording it in `docs/DECISIONS.md`.

## Agent coordinator

- Relay URL: `https://patriot-hypnoses-hubcap.ngrok-free.dev` (hosted by naasanov; it is down when that laptop sleeps or the tunnel stops).
- The three boxes are `naasanov`, `vmshah`, and `aagashe`, one per teammate.
- At the start of every new session, ask the user two things before doing other work: which box they are (`naasanov`, `vmshah`, or `aagashe`), and whether this session should subscribe to the coordinator.
- If they say yes, set `COORDINATOR_BOX` to their box and run `client.py subscribe` (and `join` first if no token is saved). Agents may use the password: take it from the user or from `COORDINATOR_PASSWORD` in the gitignored `.env`.
- The password is never written to a committed file, a commit message, or a coordinator message.
- Never assume the box from the machine; the answer is always asked, even if the previous session used the same one.

## Conventions

- `tools/agent-coordinator/` is a vendored Claude Code plugin that lets teammates' agents message each other. Dev tooling only; install with `/plugin marketplace add ./tools/agent-coordinator` (see its README).
- `.claude/worktrees/` is gitignored.
- Background sessions edit the main checkout directly (`bgIsolation: none` in `.claude/settings.json`).
