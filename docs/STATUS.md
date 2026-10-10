# Status

Update this as work lands. Mark a ticket done when its "Done when" in `TICKETS.md` is met.

## Walking skeleton (2026-10-10)

`bun test` and `bun run dev` + `bun seed` run the whole demo path on local doubles: RXS-0001 is filed, denied for the TN wholesaler attestation, remediated, refiled, approved and settled ($6.40 + $1.60 fee); email and fax claims settle; CLEAR, MARGINAL and out-of-policy claims land where they should. Every ticket below now means "replace the double with the real thing behind the same interface".

## Tickets

| Ticket | Owner | Status | Notes |
|---|---|---|---|
| INF-01 | P1 | todo | `bun probe`; Photon creds come from the scaffold |
| INF-02 | P1 | scaffolded | Server, `/ws/live`, db interface done; needs Atlas `MONGO_URI` |
| INF-03 | P1 | scaffolded | Switch + feed tee + dev door done; seed is 6 claims (needs 60); portal/inbox/fax doors are empty route files |
| INF-04 | P1 | scaffolded | Local ledger + settlement + 835-style remittance done; `NessieLedger` throws TODO |
| INF-05 | P1 | scaffolded | Orchestrator loop runs end to end; deadline clock computed but not ticking on the dashboard |
| INF-06 | P1 | scaffolded | Engine: missing-field denial + approval work; deny-first-then-concede persona (PBM_FAX) is a TODO |
| RES-01 | P2 | todo | Replace every `TODO(RES-01)` in `apps/api/src/fixtures/` |
| AGT-01 | P2 | scaffolded | CLEAR/UNDERWATER done; MARGINAL agent escalation TODO |
| AGT-02 | P2 | scaffolded | Packet from fixtures; statute extraction and real PDF TODO |
| AGT-03 | P2 | todo | `PortalAdapter` stub; `ADAPTER_MODE=real` to use it |
| AGT-04 | P2 | todo | `EmailAdapter` stub |
| AGT-05 | P2 | todo | `FaxAdapter` stub |
| AGT-06 | P2 | scaffolded | Negotiation loop works through the direct adapter; wholesaler WhatsApp is stubbed |
| AGT-07 | P2 | scaffolded | Digest + exception pings + TTS + Spectrum iMessage send/receive written; untested against a real phone; reply commands TODO |
| AGT-08 | P2 | todo | Stretch: phone negotiator |
| UI-01 | P3 | scaffolded | Shell, `/ws/live` hook, state reducer, panel stubs, theme tokens |
| UI-02 | P3 | scaffolded | Cashier submits a B1 through the switch and shows the badge; dispensing-screen UI TODO |
| UI-03 | P3 | scaffolded | Feed, pipeline, ledger render live data plainly |
| UI-04 | P3 | scaffolded | Channel viewer + phone mock (with reply box and digest button) render plainly |
| UI-05 | P3 | todo | |
| UI-06 | P3 | todo | README started |
| UI-07 | P3 | scaffolded | Token sets for dark/light/aero + switcher; Aero skin details TODO |

## Stubbed integrations

| Integration | Stubbed? | Detail |
|---|---|---|
| Nessie | yes (until INF-04) | `LEDGER_BACKEND=local` in-memory double; confirm classic vs v2 at INF-01 |
| Spectrum iMessage | no (needs creds) | Live when `PHOTON_PROJECT_ID`/`SECRET` are set; shared-plan lines only reach registered project users |
| Spectrum WhatsApp (wholesaler) | yes | Wholesaler replies instantly in the channel viewer; needs WhatsApp Business setup in Photon |
| ElevenLabs | no (needs key) | Digest is sent without audio when the key is missing |
| MongoDB Atlas | yes (until `MONGO_URI`) | In-memory store |
| PBM portal / email / fax | yes (by design) | PBM Sim mocks modeled on public procedures; agents use the `/dev` door until the doors and adapters land |
| Fax transport | yes (by design) | Mock fax line; no real fax provider |

## Blockers

None.
