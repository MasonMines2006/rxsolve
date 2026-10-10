# Status

Update this as work lands. Mark a ticket done when its "Done when" in `TICKETS.md` is met.

## Walking skeleton (2026-10-10)

`bun test` and `bun run dev` + `bun seed` run the whole demo path on local doubles: RXS-0001 is filed, denied for the TN wholesaler attestation, remediated, refiled, approved and settled ($6.40 + $1.60 fee); email and fax claims settle; CLEAR, MARGINAL and out-of-policy claims land where they should. Every ticket below now means "replace the double with the real thing behind the same interface".

## Tickets

| Ticket | Owner | Status | Notes |
|---|---|---|---|
| INF-01 | P1 | done | Nessie: classic v1 at `https://api.nessieisreal.com`; key valid (201 on a write, a fake key gets 401); `bun probe` is read-only. Photon: `bun api` logs `spectrum: iMessage connected`. Keys and Photon project id go to the group chat by hand, never the relay |
| INF-02 | P1 | scaffolded | Server, `/ws/live`, db interface done; TigerData backend + hypertables + continuous aggregate written; needs a Tiger Cloud `DATABASE_URL` |
| INF-03 | P1 | scaffolded | Switch + feed tee + dev door done; seed is 6 claims (needs 60); portal/inbox/fax doors are empty route files |
| INF-04 | P1 | scaffolded | Local ledger + settlement + 835-style remittance done; `NessieLedger` throws TODO |
| INF-05 | P1 | scaffolded | Orchestrator loop runs end to end; deadline clock computed but not ticking on the dashboard |
| INF-06 | P1 | scaffolded | Engine: missing-field denial + approval work; deny-first-then-concede persona (PBM_FAX) is a TODO |
| RES-01 | P2 | done | Specs, statutes, personas cited (NC, GA, default; CVS Caremark, Express Scripts, OptumRx). Open: CVS and Express Scripts form field labels and Express Scripts window/SLA not found in public sources; GA statute read from an older codification; TN citation not re-verified |
| AGT-01 | P2 | done (tests unrun: bun unavailable in the build sandbox) | CLEAR/UNDERWATER deterministic; MARGINAL resolved via `extract`, stays MARGINAL (pharmacist exception) with no `AGENT_API_KEY` or on model error |
| AGT-02 | P2 | done | Entitlement extracted by the agent model (fixture text with no `AGENT_API_KEY` or on error; citation always from the fixture); appeal and invoice PDFs written locally to `out/evidence/`; completeness scored against spec `required_fields` plus optional `state_rules`. Wholesaler documents added by negotiation are not re-rendered into the PDF |
| AGT-03 | P2 | done (against fake door) | `PortalAdapter` with Playwright driver (`PORTAL_MODE=browser`, untested without the P1 portal door) and scripted HTTP fallback (default); contract in DECISIONS. Needs INF-03 portal door from P1 to run end to end |
| AGT-04 | P2 | done (adapter and fake-door tests; real inbox door pending INF-03) | Composes appeal with PDFs from `out/evidence/` as base64 attachments, posts to the inbox door, parses the templated reply by regex; tested against a fake local door (`apps/api/test/email-adapter.test.ts`). Needs the INF-03 inbox door to match the contract in DECISIONS to pass end to end; unparseable replies throw (no model fallback). |
| AGT-05 | P2 | done against the assumed door contract | `FaxAdapter` posts cover sheet + evidence PDF to `/fax/:pbm`, reads the return PDF via model vision (text-layer parse with no `AGENT_API_KEY` or on error); tested against a fake local fax line. INF-03 fax door in PBM Sim still to be built to match DECISIONS.md |
| AGT-06 | P2 | done | Missing-field loop (wholesaler request, real attestation PDF, rebuilt packet, refile) tested on the direct and fax adapters; one bounded rebuttal on a disputed denial; abandons when the wholesaler is silent. Wholesaler messaging is stubbed without Photon WhatsApp creds. PBM_FAX deny-then-concede is tested against a fake fax line; the PBM Sim engine still approves outright (INF-06 TODO) |
| AGT-07 | P2 | scaffolded | Digest from audit + remittances (today and week), exception pings, APPROVE/SKIP/DETAILS/PAUSE/RESUME/LIMIT replies change state, sender check; tested with no network. Not marked done: needs a live phone with real Photon creds ("Done when"). Live run 2026-10-10: Spectrum iMessage connected, digest built, send rejected by Photon (PERMISSION_DENIED, target not allowed for this project; delivered=false). Fix: register the pharmacist phone as a project user in the Photon dashboard, then rerun `curl -X POST localhost:8000/api/digest`. Live reply-command test not run |
| AGT-08 | P2 | todo | Stretch: phone negotiator |
| AGT-09 | P2 | code complete, not done | Digest text goes out first; the ElevenLabs voice note follows as its own `channel.message` with `audio_url` (`/audio/<hash>.mp3`) and as a Spectrum voice note; no-op without `ELEVENLABS_API_KEY`/`ELEVENLABS_VOICE_ID`, TTS failure or timeout never touches the text. Spoken script and text share one summary, tested offline. Not marked done: needs a real ElevenLabs key and a registered phone (blocked with AGT-07 on Photon user registration) 
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
| Agent model (Gemini) | no | Live-verified 2026-10-10 with `AGENT_API_KEY`: `gemini-3.8-flash` accepted; simple, nullable + enum + array schemas via `responseJsonSchema`, all three thinking levels, and PDF `inlineData` input return parsed output; an invalid key throws so callers fall back to their deterministic paths |
| Nessie | yes (until INF-04) | `LEDGER_BACKEND=local` in-memory double; INF-01 confirmed classic v1 over https. The sandbox holds one blank customer from probing (Nessie has no customer delete); INF-04 ignores it |
| Spectrum iMessage | no (needs creds) | Live when `PHOTON_PROJECT_ID`/`SECRET` are set; shared-plan lines only reach registered project users. Without creds the digest, pings and replies run through the dashboard phone mock (`/api/digest`, `/api/dev/pharmacist-reply`). Set `PHARMACIST_PHONE` to restrict who may send commands |
| Spectrum WhatsApp / SMS (wholesaler) | yes | Without a delivered Photon send the wholesaler replies instantly in the channel viewer (`WHOLESALER_STUB=auto`; `silent` never replies, `manual` waits for `POST /api/dev/wholesaler-reply`). Live needs `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_APP_SECRET` plus `WHOLESALER_CONTACT`; a failed WhatsApp send retries as SMS over the iMessage line |
| ElevenLabs | stretch | Not on the core demo path; digest is text-only without a key |
| TigerData | yes (until `DATABASE_URL`) | In-memory store; the chart buckets in the API instead of the continuous aggregate |
| PBM portal / email / fax | yes (by design) | PBM Sim mocks modeled on public procedures; agents use the `/dev` door until the doors and adapters land |
| Fax transport | yes (by design) | Mock fax line; no real fax provider |

## Blockers

None.
