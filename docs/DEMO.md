# RxSolve: Demo & Submission

Part of the technical design. See [DESIGN.md](DESIGN.md) for the flow being demoed and [TICKETS.md](TICKETS.md) (UI-05, UI-06) for the gate and submission tickets.

## 20. The Demo Moment

### 30-second pitch script

> "Meadowbrook Pharmacy fills 1,800 scripts a week. Every PBM pays some of them below what the drug cost, and every PBM wants the appeal through a different door: a web portal, an email, a fax. Nobody files, because each one is five dollars and twenty minutes. RxSolve catches it at the register, builds the proof from the pharmacy's own invoice, and works whichever door that PBM actually uses. The pharmacist gets one text a day. Here's a live one..."

### E2E sandbox preflight

Only run this with the Capital One Nessie sandbox key in the gitignored root `.env`; never use a production ledger. Set `LEDGER_BACKEND=nessie`, `NESSIE_KEY`, `ADAPTER_MODE=real`, and the Gemini `AGENT_API_KEY`. Keep `PORTAL_MODE=scripted` (the default) so the demo does not depend on Playwright.

Starting the API with `LEDGER_BACKEND=nessie` performs real sandbox POSTs on first boot: it creates/reuses the synthetic `RxSolve Demo` customer and named Checking accounts, each with the documented $100,000 sandbox opening balance. A settled claim then posts two more Nessie transfers (PBM to pharmacy, pharmacy to platform), each a paired withdrawal and deposit in integer cents. Do not start the API with a key unless these sandbox writes are intended.

1. Run `bun run dev` and confirm `curl http://localhost:8000/api/health` reports `db: "tigerdata"` and `ledger: "nessie"`.
2. Run `bun seed RXS-0001`; wait for the portal denial, local wholesaler remediation, refile, and `SETTLED` stage in the dashboard.
3. Optionally run `bun seed RXS-0002` and `bun seed RXS-0003` to exercise the email and fax adapters; verify the real sandbox balances and recovered-over-time chart after each settlement.

The Photon pharmacist phone is not yet registered as a project user, so do not treat a digest send as a live-phone pass until that is fixed. Tests keep `DATABASE_URL=""` and `LEDGER_BACKEND=local`; never run tests against the shared TigerData database.

### 20.1 The scripted beat

Three PBM personas, each modeled on a real PBM's public appeal procedure. Open by naming them: "These three mock PBMs are modeled after CVS Caremark, Express Scripts, and OptumRx."

1. **Portal.** A claim underpays. The browser agent fills the Caremark-style form and uploads the invoice. The PBM denies: wholesaler attestation missing (TN rule).
2. **Remediate.** The agent requests the attestation from the wholesaler on WhatsApp, receives it, refiles through the same form, and the PBM concedes.
3. **Email and fax, in parallel.** Two more claims are filed to the Express Scripts-style inbox and the OptumRx-style fax line. They resolve on the dashboard; the fax reply is a scanned PDF the agent reads.
4. **Ledger.** Remittance adjustments and fee transfers move real Nessie balances, and the recovered-over-time chart (TigerData continuous aggregate) steps up with each settlement.
5. **Digest.** The pharmacist's phone receives the daily digest. One word replies. (Stretch: it carries a voice recap.)
6. **Exception (live).** One claim is outside the standing policy and pings the pharmacist.
7. **Stretch: phone (ElevenLabs).** On a disputed denial, the agent calls the PBM rep and wins the argument on the statute.

| Moment | What it proves |
|---|---|
| Three different doors, one agent | The product is channel-agnostic, not a one-form script |
| Denial, wholesaler fetch, refile | The system handles failure, not just the happy path |
| Scanned fax read back | Perception, not just API calls |
| Balance moves on the ledger | The money is real, not a JSON constant |
| One digest a day, one exception | It scales to a flood of claims without spamming a human |
| Phone call (stretch) | The agent negotiates, not just files |

> **The single most important demo moment.** The agent working a PBM's own door (the portal form filling itself, the denial landing, the missing document fetched, the refile approved) with no human touching it.

### 20.2 Prize-moment mapping

| Sponsor | Moment judges will verify |
|---|---|
| Photon | Daily digest and live exception on the pharmacist's iMessage; wholesaler remediation over WhatsApp/SMS |
| Nessie | Recovery visibly moving real balances between pharmacy, PBM, and platform accounts |
| TigerData | The recovered-over-time chart climbing live as settlements land, read from a continuous aggregate over the `ledger_events` hypertable (the chart's caption names the source) |
| ElevenLabs (stretch) | Only if the stretch lands: voice recap in the digest; phone negotiation with the PBM rep |
| Frutiger Aero track | Flip the dashboard from dark to light to Frutiger Aero live during the run; the PMS mock and pharmacist phone flip with it |

## 21. Submission Assets

- **README:** problem, architecture, sponsor integration map, honest note on every mocked integration
- **Screenshots:** terminal, portal fill, channel viewer, dashboard, ledger panel, pharmacist phone
- **Demo recording:** captured as backup before the live demo, never skipped
- **MLH pre-submission form:** project name, team members, one-liner. Filed before 11:59 PM. P3 owns this.
- **Per-prize checklist:** each sponsor challenge's stated submission requirements, verified individually

### What to say if asked what is mocked

The PBMs are mocks, modeled on the public appeal procedures of CVS Caremark, Express Scripts, and OptumRx, with no real logos or integrations. Fax transport is simulated. Everything on our side is real: detection, evidence assembly, statutory citation, per-channel filing, negotiation, remediation, and settlement run against real message and ledger infrastructure.

The pharmacy system and claim switch speak NCPDP-shaped messages (JSON with the real field IDs, not the wire format), and remittances are 835-style records. We call them "NCPDP-shaped", never "compliant".

Because RxSolve talks to each PBM through an adapter, pointing it at a real PBM is a new adapter and a spec, not a redesign.
