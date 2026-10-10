# RxSolve

Payments processor for pharmacies that recovers underpaid prescription claims (paid below acquisition cost) in-flight and settles the recovery on a real ledger. Built for HackNC / MLH sponsor challenges (Photon Spectrum, Capital One Nessie, ElevenLabs).

## Docs

Design lives in `docs/`:

- `docs/DESIGN.md`: problem, scope, components, architecture, flows, data contracts, agents, ledger, trust & safety
- `docs/BUILD_PLAN.md`: team roles, build order, sync checkpoints, kill-switches, shared `.env`
- `docs/TICKETS.md`: INF-*, AGT-*, UI-* tickets per phase (P1/P2/P3)
- `docs/DEMO.md`: scripted demo beat, prize mapping, submission assets

## Stack

Python 3.12 + FastAPI, MongoDB Atlas, Capital One Nessie (ledger), Photon Spectrum (`spectrum-ts`) for iMessage/WhatsApp/SMS, ElevenLabs STT/TTS, Next.js + WebSocket dashboard.

## Rules that must hold

- The mock PBM's concession is deterministic and rule-based; no model decides whether to concede.
- Watcher is deterministic on CLEAR/UNDERWATER; models only run on MARGINAL, evidence extraction, and negotiation.
- No real PHI; claims carry an opaque `patient_ref`.
- The ledger is append-only; corrections post reversing entries.
- Never file an appeal with incomplete evidence; abandon and log instead.
- If a sponsor API is dead, stub it rather than halting the demo path.

## Conventions

- `.claude/worktrees/` is gitignored.
- Background sessions edit the main checkout directly (`bgIsolation: none` in `.claude/settings.json`).
