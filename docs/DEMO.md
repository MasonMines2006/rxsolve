# RxSolve: Demo & Submission

Part of the technical design. See [DESIGN.md](DESIGN.md) for the flow being demoed and [TICKETS.md](TICKETS.md) (UI-05, UI-06) for the gate and submission tickets.

## 20. The Demo Moment

### 30-second pitch script

> "Meadowbrook Pharmacy fills 1,800 scripts a week. Every PBM pays some of them below what the drug cost, and every PBM wants the appeal through a different door: a web portal, an email, a fax. Nobody files, because each one is five dollars and twenty minutes. RxSolve catches it at the register, builds the proof from the pharmacy's own invoice, and works whichever door that PBM actually uses. The pharmacist gets one text a day. Here's a live one..."

### 20.1 The scripted beat

Three PBM personas, each modeled on a real PBM's public appeal procedure. Open by naming them: "These three mock PBMs are modeled after CVS Caremark, Express Scripts, and OptumRx."

1. **Portal.** A claim underpays. The browser agent fills the Caremark-style form and uploads the invoice. The PBM denies: wholesaler attestation missing (TN rule).
2. **Remediate.** The agent requests the attestation from the wholesaler on WhatsApp, receives it, refiles through the same form, and the PBM concedes.
3. **Email and fax, in parallel.** Two more claims are filed to the Express Scripts-style inbox and the OptumRx-style fax line. They resolve on the dashboard; the fax reply is a scanned PDF the agent reads.
4. **Ledger.** Remittance adjustments and fee transfers move real Nessie balances.
5. **Digest.** The pharmacist's phone receives the daily digest with the voice recap. One word replies.
6. **Exception (live).** One claim is outside the standing policy and pings the pharmacist.
7. **Stretch: phone.** On a disputed denial, the agent calls the PBM rep and wins the argument on the statute.

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
| ElevenLabs | Voice recap in the digest; phone negotiation with the PBM rep (stretch) |

## 21. Submission Assets

- **README:** problem, architecture, sponsor integration map, honest note on every mocked integration
- **Screenshots:** terminal, portal fill, channel viewer, dashboard, ledger panel, pharmacist phone
- **Demo recording:** captured as backup before the live demo, never skipped
- **MLH pre-submission form:** project name, team members, one-liner. Filed before 11:59 PM. P3 owns this.
- **Per-prize checklist:** each sponsor challenge's stated submission requirements, verified individually

### What to say if asked what is mocked

The PBMs are mocks, modeled on the public appeal procedures of CVS Caremark, Express Scripts, and OptumRx, with no real logos or integrations. Fax transport is simulated. Everything on our side is real: detection, evidence assembly, statutory citation, per-channel filing, negotiation, remediation, and settlement run against real message and ledger infrastructure.

Because RxSolve talks to each PBM through an adapter, pointing it at a real PBM is a new adapter and a spec, not a redesign.
