# RxSolve: Build Plan

Part of the technical design. See [DESIGN.md](DESIGN.md) for architecture, [TICKETS.md](TICKETS.md) for per-phase tickets, [DEMO.md](DEMO.md) for the demo and submission.

## 15. Team Roles

Three people, self-assigned. The only hard requirement is that P1 owns the money path.

| Phase | Ownership | Stack |
|---|---|---|
| P1 | Infrastructure, Mock PBM engine, Ledger, Orchestrator, deadline clock | Python, FastAPI, MongoDB, Nessie |
| P2 | The agents, Spectrum messaging, ElevenLabs voice loop | Python, spectrum-ts, AGENT_API_KEY |
| P3 | Dashboard, seeding, demo rehearsal, submission assets | Next.js, WebSocket |

> **Submission deadline: 11:59 PM.** One person fills out the MLH pre-submission form before the cutoff: project name, team members, one-line description. P3 owns this. Do not let it slip.

## 16. Build Order

| Hours | Milestone |
|---|---|
| T+0 to 1 | **Sponsor key sprint.** Nessie version probed, Spectrum iMessage connected, one ElevenLabs TTS call succeeds. Kill-switch: if any sponsor API fails, stub it and keep building. Never let a dead key halt the demo path. |
| T+1 to 3 | PBM adjudication engine live. 60-claim seed loaded (~18 underwater). Nessie accounts created, disbursement bills posting. |
| T+3 to 5 | Watcher and Evidence Builder producing real appeal artifacts with statute citations and invoice PDFs. |
| T+5 to 7 | Spectrum thread live. Agent posts an appeal into iMessage. PBM persona replies with a scripted denial. |
| T+7 to 9 | Negotiation loop: denial diagnosis, WhatsApp/SMS remediation, refile, concession, ledger settlement. Deadline clock running. |
| T+9 to 10 | Dashboard wired to live data. ElevenLabs voice message landing in-thread. |
| T+10 to 11 | **Demo gate.** Full run-through twice. Anything not green gets cut. Features yield to the demo path. |
| T+11 to 12 | **Freeze.** README, screenshots, backup recording, sponsor-prize checklist verified. |

## 17. Sync Checkpoints

| Time | Checkpoint |
|---|---|
| T+1 | All three sponsor APIs proven. Nessie version identified. Spectrum iMessage connected. ElevenLabs TTS returns audio. Kill-switch: stub anything dead. |
| T+3 | Seed loaded. PBM engine adjudicates. Ledger accounts exist and a test bill posts. Keys and URIs in group chat. |
| T+5 | Evidence Builder produces a real appeal PDF with a correct statutory citation for at least one state. |
| T+7 | Agent posts an appeal into the live iMessage thread. PBM persona replies with a denial. End-to-end without the dashboard. |
| T+9 | Full loop including remediation, concession, and ledger settlement. Deadline clock visible. |
| T+10 | Dashboard live on all panels. Voice message lands in-thread. Demo gate: go/no-go. |
| T+11 | Code freeze. Nobody touches main. Demo recording captured as backup. |
| 11:59 PM | MLH pre-submission form submitted. |

### Kill-switch conditions

Escalate to a stub immediately if any of these hold at T+1:

- **Nessie key dead:** stub with a local ledger double, note it in the README, keep building
- **Spectrum iMessage will not connect:** fall back to a simulated thread rendered in the dashboard
- **ElevenLabs key dead:** drop the voice leg; it is the least load-bearing sponsor moment

Never let a dead sponsor key halt the demo path. The core loop (detect, prove, file, negotiate, settle) is the product. Sponsors amplify it; they do not constitute it.

## 19. Shared `.env`

Post in group chat immediately.

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
PHARMACY_ID=PH-MEADOWBROOK
PLATFORM_ACCOUNT=RXSOLVE-PLATFORM
```
