# RxSolve: Demo & Submission

Part of the technical design. See [DESIGN.md](DESIGN.md) for the flow being demoed and [TICKETS.md](TICKETS.md) (UI-05, UI-06) for the gate and submission tickets.

## 20. The Demo Moment

### 30-second pitch script

> "Meadowbrook Pharmacy fills 1,800 scripts a week on RxSolve. Yesterday our processor caught $47.80 of claims paid below what the drugs actually cost, and recovered every cent without one human filing a thing. Here's a live one: a patient is checking out right now. Cashier hits pay. Claim goes to the PBM. PBM pays $6.40 under acquisition cost. Our detector flags it at the point of sale, the evidence agent attaches the wholesaler invoice and cites the Tennessee seven-business-day appeal window, and our filing agent pushes it into the PBM's actual iMessage thread. Watch it land..."

### 20.1 The scripted beat

The demo claim is conditionally denied on first filing. Tennessee requires a wholesaler attestation that is not yet attached. The Negotiation Agent reads the denial inside the thread, messages the wholesaler on WhatsApp, receives the attestation, refiles, and the PBM concedes. The reversal posts to the Nessie ledger, the 25% contingency fee transfers out, and a voice message confirms the recovery in the thread.

| Moment | What it proves |
|---|---|
| Denial arrives in-thread | The system handles failure, not just the happy path |
| Agent remediates via WhatsApp | Photon used natively across multiple platforms, with attachments |
| Approval follows | The loop actually closes, deterministically |
| Balance moves on the ledger | The money is real, not a JSON constant |
| Voice message lands | Two sponsor moments satisfied simultaneously |

> **The single most important demo moment.** The iMessage thread: the denial arriving, the agent responding with the missing document attached, and the approval following, on a real messaging surface, in front of the judges. Everything else is scaffolding around that moment.

### 20.2 Prize-moment mapping

| Sponsor | Moment judges will verify |
|---|---|
| Photon | Agents conversing natively in iMessage, plus simultaneous WhatsApp/SMS remediation during the live beat |
| Nessie | The recovery visibly moving real balances between four accounts |
| ElevenLabs | The voice message confirming recovery inside the thread |

## 21. Submission Assets

- **README:** problem, architecture, sponsor integration map, honest note on any stubbed integration
- **Screenshots:** terminal, thread, dashboard, ledger panel
- **Demo recording:** captured as backup before the live demo, never skipped
- **MLH pre-submission form:** project name, team members, one-liner. Filed before 11:59 PM. P3 owns this.
- **Per-prize checklist:** each sponsor challenge's stated submission requirements, verified individually

### What to say if asked what is mocked

The adjudication engine is mocked; the recovery loop is real. Detection, evidence assembly, statutory citation, negotiation, remediation, escalation, and settlement all execute live against real message and ledger infrastructure.

That is the honest framing, and it is stronger than pretending otherwise.
