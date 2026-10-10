# Status

Update this as work lands. Mark a ticket done when its "Done when" in `TICKETS.md` is met.

## Walking skeleton (2026-10-10)

`bun test` and `bun run dev` + `bun seed` run the whole demo path on local doubles: RXS-0001 is filed, denied for the TN wholesaler attestation, remediated, refiled, approved and settled ($6.40 + $1.60 fee); email and fax claims settle; CLEAR, MARGINAL and out-of-policy claims land where they should. Every ticket below now means "replace the double with the real thing behind the same interface".

## Tickets

| Ticket | Owner | Status | Notes |
|---|---|---|---|
| INF-01 | P1 | todo | `bun probe`; Photon creds come from the scaffold |
| INF-02 | P1 | scaffolded | Server, `/ws/live`, db interface done; TigerData backend + hypertables + continuous aggregate written; needs a Tiger Cloud `DATABASE_URL` |
| INF-03 | P1 | scaffolded | Switch + feed tee + dev door done; seed is 6 claims (needs 60); portal/inbox/fax doors are empty route files |
| INF-04 | P1 | scaffolded | Local ledger + settlement + 835-style remittance done; `NessieLedger` throws TODO |
| INF-05 | P1 | scaffolded | Orchestrator loop runs end to end; deadline clock computed but not ticking on the dashboard |
| INF-06 | P1 | scaffolded | Engine: missing-field denial + approval work; deny-first-then-concede persona (PBM_FAX) is a TODO |
| RES-01 | P2 | done | Specs, statutes, personas cited (NC, GA, default; CVS Caremark, Express Scripts, OptumRx). Open: CVS and Express Scripts form field labels and Express Scripts window/SLA not found in public sources; GA statute read from an older codification; TN citation not re-verified |
| AGT-01 | P2 | done (tests unrun: bun unavailable in the build sandbox) | CLEAR/UNDERWATER deterministic; MARGINAL resolved via `extract`, stays MARGINAL (pharmacist exception) with no `AGENT_API_KEY` or on model error |
| AGT-02 | P2 | scaffolded | Packet from fixtures; statute extraction and real PDF TODO |
| AGT-03 | P2 | todo | `PortalAdapter` stub; `ADAPTER_MODE=real` to use it |
| AGT-04 | P2 | todo | `EmailAdapter` stub |
| AGT-05 | P2 | todo | `FaxAdapter` stub |
| AGT-06 | P2 | scaffolded | Negotiation loop works through the direct adapter; wholesaler WhatsApp is stubbed |
| AGT-07 | P2 | scaffolded | Digest from audit + remittances (today and week), exception pings, APPROVE/SKIP/DETAILS/PAUSE/RESUME/LIMIT replies change state, sender check; tested with no network. Not marked done: needs a live phone with real Photon creds ("Done when") |
| AGT-08 | P2 | todo | Stretch: phone negotiator |
| AGT-09 | P2 | scaffolded | Stretch: digest voice recap; `voice.ts` written, no-ops without a key |
| UI-01 | P3 | scaffolded | Shell, `/ws/live` hook, state reducer, panel stubs, theme tokens |
| UI-02 | P3 | scaffolded | Cashier submits a B1 through the switch and shows the badge; dispensing-screen UI TODO |
| UI-03 | P3 | scaffolded | Feed, pipeline, ledger render live data plainly; recovered-over-time chart reads `/api/ledger/series` |
| UI-04 | P3 | scaffolded | Channel viewer + phone mock (with reply box and digest button) render plainly |
| UI-05 | P3 | todo | |
| UI-06 | P3 | todo | README started |
| UI-07 | P3 | scaffolded | Token sets for dark/light/aero + switcher; Aero skin details TODO |

## Stubbed integrations

| Integration | Stubbed? | Detail |
|---|---|---|
| Nessie | yes (until INF-04) | `LEDGER_BACKEND=local` in-memory double; confirm classic vs v2 at INF-01 |
| Spectrum iMessage | no (needs creds) | Live when `PHOTON_PROJECT_ID`/`SECRET` are set; shared-plan lines only reach registered project users. Without creds the digest, pings and replies run through the dashboard phone mock (`/api/digest`, `/api/dev/pharmacist-reply`). Set `PHARMACIST_PHONE` to restrict who may send commands |
| Spectrum WhatsApp (wholesaler) | yes | Wholesaler replies instantly in the channel viewer; needs WhatsApp Business setup in Photon |
| ElevenLabs | stretch | Not on the core demo path; digest is text-only without a key |
| TigerData | yes (until `DATABASE_URL`) | In-memory store; the chart buckets in the API instead of the continuous aggregate |
| PBM portal / email / fax | yes (by design) | PBM Sim mocks modeled on public procedures; agents use the `/dev` door until the doors and adapters land |
| Fax transport | yes (by design) | Mock fax line; no real fax provider |

## Blockers

None.
