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

Python 3.12 + FastAPI, MongoDB Atlas, Capital One Nessie (ledger), Photon Spectrum (`spectrum-ts`) for iMessage/WhatsApp/SMS, ElevenLabs STT/TTS, Next.js + WebSocket dashboard.

## Git rhythm

- Commit small and often, one logical change per commit.
- Pull/rebase before starting work and before pushing.
- Work on `main`. Stay in your phase's files (P1 backend/ledger, P2 agents/messaging, P3 dashboard) to avoid conflicts.
- Never force-push. After the T+11 code freeze, nobody touches `main`.
- Never commit secrets. `.env` is gitignored; only `.env.example` is committed.

## Living docs

- `docs/` is the source of truth. Change code and the doc that describes it in the same commit.
- If code and docs contradict, resolve it immediately: fix the doc, or fix the code and record why.
- Record every decision or contract change as one line in `docs/DECISIONS.md` (date, decision, why).
- Record stubs, blockers, and ticket progress in `docs/STATUS.md`. Mark tickets done when their "Done when" is met.
- Team knowledge goes in `docs/` or this file, not in per-machine agent memory (memory is not shared across teammates).

## Shared contracts

- The JSON shapes in `DESIGN.md` section 5.3 and the `/ws/live` event shapes are interfaces between phases.
- Changing one means logging it in `DECISIONS.md` and saying so in the commit message.

## Rules that must hold

- The mock PBM's concession is deterministic and rule-based; no model decides whether to concede.
- Watcher is deterministic on CLEAR/UNDERWATER; models only run on MARGINAL, evidence extraction, and negotiation.
- No real PHI; claims carry an opaque `patient_ref`.
- The ledger is append-only; corrections post reversing entries.
- Never file an appeal with incomplete evidence; abandon and log instead.
- If a sponsor API is dead, stub it and record the stub in `docs/STATUS.md` and the README; never halt the demo path.
- Anything not on the four-minute demo path gets cut (T+10 rule).
- Do not add or rename components from the docs without recording it in `docs/DECISIONS.md`.

## Conventions

- `.claude/worktrees/` is gitignored.
- Background sessions edit the main checkout directly (`bgIsolation: none` in `.claude/settings.json`).
