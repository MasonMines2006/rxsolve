# RxSolve: Build Plan

Part of the technical design. See [DESIGN.md](DESIGN.md) for architecture, [TICKETS.md](TICKETS.md) for per-phase tickets, [DEMO.md](DEMO.md) for the demo and submission.

## 15. Team Roles

Three people, self-assigned. The only hard requirement is that P1 owns the money path.

| Phase | Ownership | Stack |
|---|---|---|
| P1 | Infrastructure, PBM Sim, Ledger, Orchestrator, deadline clock | Python, FastAPI, MongoDB, Nessie |
| P2 | Research, agents, channel adapters, Spectrum notifier, ElevenLabs voice | Python, Playwright, spectrum-ts, AGENT_API_KEY |
| P3 | Dashboard, seeding, demo rehearsal, submission assets | Next.js, WebSocket |

> **Submission deadline: 11:59 PM.** P3 files the MLH pre-submission form before the cutoff. Do not let it slip.

## 16. Build Order

| Hours | Milestone |
|---|---|
| T+0 to 1 | **Sponsor key sprint.** Nessie version probed, Spectrum iMessage connected, one ElevenLabs TTS call succeeds. Stub anything dead. In parallel, RES-01 starts pulling PBM appeal procedures. |
| T+1 to 3 | PBM Sim switch live with decision engine. 60-claim seed loaded across three personas. Nessie accounts created. PBM specs drafted from RES-01. |
| T+3 to 5 | Watcher and Evidence Builder producing PBM-shaped appeal artifacts. PBM Sim portal form live. |
| T+5 to 7 | Portal adapter files a claim and reads the denial. Email adapter and inbox working. |
| T+7 to 9 | Fax adapter and fax line. Negotiation loop: denial, wholesaler remediation, refile, concession, ledger settlement. |
| T+9 to 10 | Digest and exception pings on iMessage. Voice recap. Dashboard wired to live data. Phone negotiator starts only if everything above is green. |
| T+10 to 11 | **Demo gate.** Full run-through twice. Anything not green gets cut. |
| T+11 to 12 | **Freeze.** README, screenshots, backup recording, sponsor-prize checklist verified. |

## 17. Sync Checkpoints

| Time | Checkpoint |
|---|---|
| T+1 | Three sponsor APIs proven. Nessie version identified. Spectrum iMessage connected. TTS returns audio. |
| T+3 | Seed loaded. PBM Sim adjudicates. Ledger accounts exist and a test transfer posts. Specs drafted. |
| T+5 | Evidence Builder produces a PBM-shaped PDF with a correct citation. Portal form renders and accepts a POST. |
| T+7 | Portal adapter files and receives a denial end to end without the dashboard. Email path works. |
| T+9 | Full loop on all three channels including remediation, concession, settlement. Deadline clock visible. |
| T+10 | Dashboard live. Digest and voice recap land on the phone. Demo gate: go/no-go on the phone stretch. |
| T+11 | Code freeze. Nobody touches main. Backup recording captured. |
| 11:59 PM | MLH pre-submission form submitted. |

### Kill-switch conditions

Escalate to a stub immediately if any of these hold:

- **Nessie key dead:** local ledger double, noted in the README
- **Spectrum iMessage will not connect:** simulated phone rendered in the dashboard
- **ElevenLabs key dead:** drop the voice recap and phone stretch
- **Browser agent flaky at T+7:** the portal adapter runs a scripted Playwright fill; the agent still reads the denial
- **Fax OCR flaky:** the fax line returns a text-layer PDF, so vision is not needed
- **Email inbox troublesome:** the mock mailbox stays internal to PBM Sim; no real mail provider

Never let a dead dependency halt the demo path.

## 19. Shared `.env`

```bash
AGENT_API_KEY=...
MONGO_URI=mongodb+srv://...
NESSIE_KEY=...            # classic API: key as ?key= query param
# NESSIE_API_KEY=...      # v2 API: header auth instead
# NESSIE_SECRET=...
NESSIE_VERSION=v1         # CONFIRM at INF-01
PHOTON_API_KEY=...        # from the MLH sponsor link
PHOTON_WORKSPACE_URL=...  # dashboard URL for the iMessage connection
ELEVENLABS_API_KEY=...
ELEVENLABS_VOICE_ID=...
PBM_SIM_URL=http://localhost:8100
PHARMACY_ID=PH-MEADOWBROOK
PLATFORM_ACCOUNT=RXSOLVE-PLATFORM
PHARMACIST_PHONE=...      # iMessage digest destination
WHOLESALER_CONTACT=...    # WhatsApp/SMS destination
```
