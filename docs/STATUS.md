# Status

Update this as work lands. Mark a ticket done when its "Done when" in `TICKETS.md` is met.

## Walking skeleton (2026-10-10)

`bun test` and `bun run dev` + `bun seed` run the whole demo path on local doubles: RXS-0001 is filed, denied for the TN wholesaler attestation, remediated, refiled, approved and settled ($6.40 + $1.60 fee); email and fax claims settle; CLEAR, MARGINAL and out-of-policy claims land where they should. Every ticket below now means "replace the double with the real thing behind the same interface".

## Tickets

| Ticket | Owner | Status | Notes |
|---|---|---|---|
| INF-01 | P1 | done | Nessie: classic v1 at `https://api.nessieisreal.com`; key valid (201 on a write, a fake key gets 401); `bun probe` is read-only. Photon: `bun api` logs `spectrum: iMessage connected`. Keys and Photon project id go to the group chat by hand, never the relay |
| INF-02 | P1 | in progress | TigerData schema bootstrap and API health 200 (`db=tigerdata`) verified; `/ws/live` replays `ledger.balances`. Claim persistence across process restart remains unverified to avoid test rows in the shared DB |
| INF-03 | P1 | done | Portal/inbox/fax doors implement the logged P2 contracts; seed expands 6 templates to 60 (18 underwater, 39 clear, 3 marginal); local HTTP integration covers all three adapters and boundary test passes |
| INF-04 | P1 | blocked | `NessieLedger` classic v1 customer/account discovery, transfers, and balance reads have fake-HTTP tests. A synthetic E2E reached settlement but the first `/accounts/{id}/transfers` POST returned HTTP 400; read-only checks found balances unchanged. Transfer payload schema must be confirmed before another write; `local` remains default |
| INF-05 | P1 | in progress | CLEAR, UNDERWATER, and policy-exception paths pass the 60-claim local HTTP replay; deadline countdown is wired to appeal deadlines, but visual end-to-end verification remains pending |
| INF-06 | P1 | done | Deterministic named-field denials, missing-evidence approval, and PBM_FAX deny-first/rebuttal concession implemented and tested through the local doors |
| RES-01 | P2 | done | Specs, statutes, personas cited (NC, GA, default; CVS Caremark, Express Scripts, OptumRx). Open: CVS and Express Scripts form field labels and Express Scripts window/SLA not found in public sources; GA statute read from an older codification; TN citation not re-verified |
| AGT-01 | P2 | done | CLEAR/UNDERWATER deterministic; MARGINAL resolved via `extract`, stays MARGINAL (pharmacist exception) with no `AGENT_API_KEY` or on model error |
| AGT-02 | P2 | done | Entitlement extracted by the agent model (fixture text with no `AGENT_API_KEY` or on error; citation always from the fixture); appeal and invoice PDFs written locally to `out/evidence/`; completeness scored against spec `required_fields` plus optional `state_rules`. Wholesaler documents added by negotiation are not re-rendered into the PDF |
| AGT-03 | P2 | done | Scripted and Playwright portal drivers; scripted driver passes end-to-end against the local PBM Sim portal door. Browser mode remains optional and was not exercised |
| AGT-04 | P2 | done | Email adapter passes end-to-end against the local PBM Sim inbox door, including named-field denial and same-thread refile |
| AGT-05 | P2 | done | Fax adapter passes end-to-end against the local PBM Sim fax door, including PDF return parsing and same-ticket rebuttal |
| AGT-06 | P2 | done | Missing-field remediation, PDF rebuild/refile, bounded rebuttal, and abandonment pass through the local PBM Sim doors. Wholesaler WhatsApp remains stubbed without Photon Business credentials; PBM_FAX now deterministically disputes a complete first round and approves the rebuttal |
| AGT-07 | P2 | blocked | Digest/reply code and offline tests complete; sender authorization uses exact normalized matching. Live Photon send returned `PERMISSION_DENIED` because the pharmacist phone is not registered as a project user; live reply test awaits registration |
| AGT-08 | P2 | done against the simulated rep | Stretch. After one rebuttal, a second dispute calls the rep once when `PHONE_REP_URL` or `PHONE_MODE=sim` is set (else supervisor escalation as before). WebSocket audio loop with ElevenLabs STT/TTS, stub text codec without creds; the simulated rep (`adapters/phone-sim/rep.ts`) concedes by rule when the statute and figure are cited. Bounded to 3 turns, call stops at the appeal deadline, failure abandons with an exception ping. Not run against real ElevenLabs or telephony; PBM Sim's own rep line (P1) is not built |
| AGT-09 | P2 | blocked | Voice recap code and offline tests complete; real verification needs an ElevenLabs key/voice ID and the pharmacist phone registered with Photon |
| UI-01 | P3 | in progress | Responsive dashboard shell and `/ws/live` hook with event-frame checks/reconnect backoff; workspace typecheck/dashboard build pass, live replay visual check pending |
| UI-02 | P3 | in progress | Selectable fictional dispensing queue submits NCPDP-shaped B1 and renders request/response plus live badge; end-to-end dashboard submit/live-badge check pending |
| UI-03 | P3 | in progress | Feed and pipeline cards show event-derived amount, PBM, channel, and ticking appeal deadline; verify displayed dollars against Nessie after INF-04 lands |
| UI-04 | P3 | in progress | Per-claim/channel transcript and interactive pharmacist phone mock implemented; full live run across all channels pending |
| UI-05 | P3 | todo | Requires two consecutive timed end-to-end runs with no manual intervention; not yet verified |
| UI-06 | P3 | todo | README exists; screenshots, backed-up recording, sponsor checklist verification, and MLH form submission remain manual |
| UI-07 | P3 | in progress | Dark/light/Aero token skins and persistent accessible switcher implemented; workspace typecheck/dashboard build pass, visual contrast check across all panels/devices pending |

## Stubbed integrations

| Integration | Stubbed? | Detail |
|---|---|---|
| Agent model (Gemini) | no | Live-verified 2026-10-10 with `AGENT_API_KEY`: `gemini-3.8-flash` accepted; simple, nullable + enum + array schemas via `responseJsonSchema`, all three thinking levels, and PDF `inlineData` input return parsed output; an invalid key throws so callers fall back to their deterministic paths |
| Nessie | partial | Classic v1 adapter is implemented; `LEDGER_BACKEND=local` remains the default until live transfers are verified. No live transfer was made because `NESSIE_KEY` is unset |
| Spectrum iMessage | partial | SDK connects with project credentials, but live sends require the pharmacist phone to be registered as a project user. Dashboard phone mock remains available; `PHARMACIST_PHONE` restricts inbound commands |
| Spectrum WhatsApp / SMS (wholesaler) | yes | Without a delivered Photon send the wholesaler replies instantly in the channel viewer (`WHOLESALER_STUB=auto`; `silent` never replies, `manual` waits for `POST /api/dev/wholesaler-reply`). Live needs `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_APP_SECRET` plus `WHOLESALER_CONTACT`; a failed WhatsApp send retries as SMS over the iMessage line |
| ElevenLabs | stretch | Not on the core demo path; digest is text-only without a key. Phone negotiator (AGT-08) runs on a stub text codec without `ELEVENLABS_API_KEY` and `ELEVENLABS_VOICE_ID`, against the in-process simulated rep (`PHONE_MODE=sim`); real telephony is out of scope, `PHONE_REP_URL` is the hook point |
| TigerData | partial | `DATABASE_URL` connects and schema bootstrap succeeds; process-restart claim persistence is not yet verified |
| PBM portal / email / fax | yes (by design) | Deterministic local PBM Sim doors match adapter contracts; no real PBM connections |
| Fax transport | yes (by design) | Mock fax line; no real fax provider |

## Blockers

- INF-02 still needs claim persistence verified across an API restart; avoid test inserts into the shared TigerData instance.
- INF-04 Nessie account setup ran in the sandbox, but the first transfer POST returned HTTP 400 and balances stayed unchanged. Confirm the Classic v1 transfer payload before retrying any write.
- AGT-07 live digest/reply checks await pharmacist-number registration in the Photon project.
- AGT-09 live voice verification is stretch and needs an ElevenLabs key/voice ID and the registered Photon phone.
- UI-05/06 still need the timed live rehearsal and submission assets/form work.
