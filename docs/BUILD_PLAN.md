# RxSolve: Build Plan

Part of the technical design. See [DESIGN.md](DESIGN.md) for architecture, [TICKETS.md](TICKETS.md) for per-phase tickets, [DEMO.md](DEMO.md) for the demo and submission.

## 15. Team Roles

Three people, self-assigned. The only hard requirement is that P1 owns the money path.

| Phase | Ownership | Stack |
|---|---|---|
| P1 | Infrastructure, PBM Sim, Ledger, Orchestrator, deadline clock | TypeScript/Bun, MongoDB, Nessie (`apps/api` spine, `apps/pbm-sim`) |
| P2 | Research, agents, channel adapters, Spectrum notifier; ElevenLabs voice (stretch) | TypeScript/Bun, Playwright, spectrum-ts, Claude via AGENT_API_KEY (`apps/api/src/agents`, `adapters`, `messaging`) |
| P3 | Dashboard, seeding, demo rehearsal, submission assets | Next.js, WebSocket (`apps/dashboard`) |

A walking skeleton is in place: `bun test` and `bun seed` already run the whole demo path on local doubles (direct adapter, local ledger, in-memory db, dashboard phone mock). Each ticket replaces a double with the real thing behind the same interface, so no phase waits on another.

> **Submission deadline: 11:59 PM.** P3 files the MLH pre-submission form before the cutoff. Do not let it slip.

## 16. Build Order

| Hours | Milestone |
|---|---|
| T+0 to 1 | **Sponsor key sprint.** Nessie version probed, Spectrum iMessage connected. Stub anything dead. ElevenLabs is stretch and not part of the sprint. In parallel, RES-01 starts pulling PBM appeal procedures. |
| T+1 to 3 | PBM Sim switch live with decision engine. 60-claim seed loaded across three personas. Nessie accounts created. PBM specs drafted from RES-01. |
| T+3 to 5 | Watcher and Evidence Builder producing PBM-shaped appeal artifacts. PBM Sim portal form live. |
| T+5 to 7 | Portal adapter files a claim and reads the denial. Email adapter and inbox working. |
| T+7 to 9 | Fax adapter and fax line. Negotiation loop: denial, wholesaler remediation, refile, concession, ledger settlement. |
| T+9 to 10 | Digest and exception pings on iMessage. Dashboard wired to live data. Theme skins and switcher (UI-07). Stretch (voice recap, then phone negotiator) starts only if everything above is green. |
| T+10 to 11 | **Demo gate.** Full run-through twice. Anything not green gets cut. |
| T+11 to 12 | **Freeze.** README, screenshots, backup recording, sponsor-prize checklist verified. |

## 17. Sync Checkpoints

| Time | Checkpoint |
|---|---|
| T+1 | Nessie and Photon proven. Nessie version identified. Spectrum iMessage connected. |
| T+3 | Seed loaded. PBM Sim adjudicates. Ledger accounts exist and a test transfer posts. Specs drafted. |
| T+5 | Evidence Builder produces a PBM-shaped PDF with a correct citation. Portal form renders and accepts a POST. |
| T+7 | Portal adapter files and receives a denial end to end without the dashboard. Email path works. |
| T+9 | Full loop on all three channels including remediation, concession, settlement. Deadline clock visible. |
| T+10 | Dashboard live. Digest lands on the phone. Demo gate: go/no-go on the ElevenLabs stretch (voice recap, phone). |
| T+11 | Code freeze. Nobody touches main. Backup recording captured. |
| 11:59 PM | MLH pre-submission form submitted. |

### Kill-switch conditions

Escalate to a stub immediately if any of these hold:

- **Nessie key dead:** local ledger double, noted in the README
- **Spectrum iMessage will not connect:** simulated phone rendered in the dashboard
- **ElevenLabs (stretch) not working by T+10:** drop the voice recap and phone stretch; the text digest stands alone
- **Browser agent flaky at T+7:** the portal adapter runs a scripted Playwright fill; the agent still reads the denial
- **Fax OCR flaky:** the fax line returns a text-layer PDF, so vision is not needed
- **Email inbox troublesome:** the mock mailbox stays internal to PBM Sim; no real mail provider

Never let a dead dependency halt the demo path.

## 19. Shared `.env`

One `.env` at the repo root, read by every app. The full annotated list is `.env.example`; empty values fall back to local doubles.

```bash
AGENT_API_KEY=...             # Claude
MONGO_URI=mongodb+srv://...   # empty -> in-memory
LEDGER_BACKEND=local          # local | nessie
NESSIE_KEY=...                # classic API: key as ?key= query param
NESSIE_VERSION=v1             # CONFIRM at INF-01
PHOTON_PROJECT_ID=...         # from `bun create spectrum-project` or the Photon dashboard
PHOTON_PROJECT_SECRET=...
ELEVENLABS_API_KEY=...        # stretch; empty -> digest without voice
ELEVENLABS_VOICE_ID=...
PBM_SIM_URL=http://localhost:8100
CLAIM_FEED_URL=http://localhost:8000/api/feed/claim
ADAPTER_MODE=direct           # direct | real
PHARMACY_ID=PH-MEADOWBROOK
PLATFORM_ACCOUNT=RXSOLVE-PLATFORM
PHARMACIST_PHONE=...          # iMessage digest destination (register it as a Photon project user)
WHOLESALER_CONTACT=...        # WhatsApp/SMS destination
```
