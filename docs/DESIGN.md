# RxSolve: Technical Design

*Rx + resolve.* A payments processor for pharmacies that guarantees every prescription claim resolves at or above acquisition cost, recovering in-flight and automatically, with no human filing anything.

HackNC, MLH Sponsor Challenges, v1.0. October 10, 2026. 24-hour event, 12-hour build window, 3 people.

| Sponsor | Role |
|---|---|
| Photon Spectrum | iMessage, WhatsApp, SMS |
| Capital One Nessie | Ledger |
| ElevenLabs | Voice (STT + TTS) |

Related docs: [BUILD_PLAN.md](BUILD_PLAN.md), [TICKETS.md](TICKETS.md), [DEMO.md](DEMO.md).

## 1. Overview and the Problem

### 1.1 The problem, concretely

When a patient fills a prescription, the claim adjudicates through the pharmacy benefit manager's (PBM) switch and the pharmacy is reimbursed a contracted rate. For generic drugs, that rate is capped by a MAC list, a maximum allowable cost schedule maintained by the PBM and updated at its discretion.

When that cap sits below the pharmacy's wholesale acquisition cost, the pharmacy dispenses the drug anyway, because the patient needs it, and eats the loss. The arithmetic is brutal and completely invisible:

| One pharmacy, generic-heavy book | |
|---|---|
| Generic claims filled per day | 200 |
| Average shortfall per claim | $2.00 |
| Annual unrecovered revenue | $146,000 |
| Claims legally appealable (35+ states) | 100% |
| Claims actually appealed today | ~0% |

Nobody appeals because each claim is worth $5 and takes twenty minutes of manual work to assemble, file, and chase. The money is owed by rule and uncollected by arithmetic. It is the purest possible instance of sub-human-threshold work: real, legal, recurring, and completely beneath the attention of every human in the loop.

### 1.2 What RxSolve is

Not a reporting dashboard. Not a document-scanning service. Not a back-office analytics tool.

A payments processor whose product surface is a single guarantee: **the claim resolved at or above cost.**

The pharmacy changes nothing about how it operates: no new portal, no new login, no new report, no behavior change. The recovery runs in the background of transactions the pharmacy already processes.

### 1.3 Core thesis

> The claim is authorized at the point of sale, the underpayment is proven with the pharmacy's own invoice, and the recovery is settled in real accounts. Tamper-proof, timestamped, and settled on a rail a judge can inspect.

This is the same architecture that makes the system trustworthy in production. It is also the architecture that makes it legible on stage.

## 2. Scope

### 2.1 In

- Real-time underpayment detection at point of sale (NADAC + acquisition cost + contract rate)
- Statutory citation generation with per-state appeal windows
- Evidence PDF assembly from the wholesaler invoice line
- Live iMessage appeal, denial, remediation, refile, concession
- Deterministic concession logic with live denial handling
- Deadline clock with state-regulator escalation path
- Nessie settlement: reversing bill plus contingency fee
- ElevenLabs voice message delivered into the live thread
- Four-panel dashboard plus cashier terminal
- 60-claim seeded history (~18 underwater)
- Abandonment logging with reasons, reported honestly

### 2.2 Out (and it stays out)

- Real PBM portals or real payer integrations
- Real NADAC API (seeded fixture only)
- Multi-pharmacy or multi-state rollout beyond the demo
- Any real PHI (synthetic patient references only)
- ElevenLabs hosted Conversational AI (requires a dashboard-configured agent; we self-implement the loop)
- Graph visualization beyond a pipeline board
- Auth, multi-tenancy, production hardening

> **The T+10 Rule.** Anything not visible in a four-minute demo gets cut at T+10. Features yield to the demo path, never the reverse.

## 3. System Components

Nine components, three owners. Each is described in full in its own section.

| Component | Owner | Responsibility |
|---|---|---|
| Orchestrator | P1 | Central coordinator. Performs no recovery action itself. Verifies the pipeline is live, checks the ledger account exists, then spawns agents in strict sequence: Watcher first; Evidence Builder only on an UNDERWATER verdict; Filing Agent only on complete evidence; Negotiation only on a denial. |
| Adjudication Watcher | P2 | Runs synchronously on every claim at point of sale. Compares the adjudicated amount against acquisition cost, NADAC, and contract rate. Emits CLEAR, MARGINAL, or UNDERWATER with a computed delta. |
| Evidence Builder | P2 | Runs only on UNDERWATER. Retrieves the governing state statute, extracts the entitlement, assembles the wholesaler invoice as a signed PDF, and scores completeness against the PBM's required-field list. |
| Filing & Negotiation | P2 | **Filing mode** (deterministic): fill the PBM's published appeal spec, attach evidence, post into the live thread. **Negotiation mode** (agentic): on denial, diagnose the cause and choose remediate, escalate, or abandon. |
| Voice Agent | P2 | Bounded loop: audio, STT, AGENT_API_KEY, TTS, delivered as a native voice message in the iMessage thread. |
| Photon / Spectrum | P2 | Binds the RxSolve agent into iMessage as a real, visible conversation partner. Simultaneously bound to WhatsApp and SMS to contact the wholesaler for missing documentation. |
| Nessie Ledger | P1 | The settlement rail. Pharmacy account, PBM account, and platform account as real ledger entities. Disbursement posts, reversing bill posts, fee transfers. |
| Mock PBM Engine | P1 | Deterministic claim pricing with realistic MAC behavior and a seeded below-cost bias. Also plays the scripted persona in the thread. Concession is rule-based, never model-generated. |
| Dashboard | P3 | Four surfaces over WebSocket: cashier terminal, live recovery feed, pipeline board, ledger panel, thread viewer. |

## 4. Architecture

Components are grouped by owning phase: P1 (infrastructure), P2 (agents and messaging), P3 (dashboard).

```
Cashier Terminal (P3)              patient pays
        |
        v
Orchestrator (P1)                  sequences agents, gates transitions
        |
        +--> Adjudication Watcher (P2)       deterministic
        +--> Evidence Builder (P2)           fully agentic
        +--> Filing & Negotiation (P2)       form-fill / agentic
        +--> Voice Agent (P2)                ElevenLabs STT/TTS
        |
        v
Photon / Spectrum (P2)
  iMessage thread: agent <-> PBM persona
  WhatsApp / SMS:  agent <-> wholesaler

Deadline Clock (P1)                state windows
Nessie Ledger (P1)                 recovery bill + 25% fee
Dashboard (P3)                     WebSocket live feed
```

## 5. Core Flows

### 5.1 Happy path with remediation (the demo path)

This is the sequence the judges will see. It fails at step 5 and recovers at step 6.

```
Cashier pays -> PBM adjudicates -> Watcher flags -> Evidence Builder -> Filing Agent posts
(POST /charge)  (paid = $6.40)     UNDERWATER       (invoice+statute)   into iMessage
      |
      v
PBM persona replies -> Negotiation -> WhatsApp   -> PBM concedes -> Nessie settles -> Voice
DENIED (missing field)  remediates    wholesaler    APPROVED        reversal + 25%    confirmation
```

1. Cashier submits `{ndc, qty, plan}`
2. PBM engine adjudicates: paid $6.40 against acquisition cost $12.80
3. Watcher: UNDERWATER, delta = $6.40, deadline = TN, 7 business days
4. Evidence Builder assembles appeal PDF plus citation block, posts to the thread
5. PBM persona replies: DENIED, wholesaler attestation missing (TN rule)
6. Negotiation Agent diagnoses the missing field, messages wholesaler on WhatsApp, receives attestation, refiles
7. PBM persona replies: APPROVED, reversing bill $6.40
8. Ledger: reversal PBM to pharmacy $6.40; fee pharmacy to platform $1.60
9. Voice Agent posts a voice message in-thread: "Recovered $6.40"
10. Dashboard updates live; deadline clock satisfied

### 5.2 End-to-end data flow

| Stage | Data contract |
|---|---|
| Human input | Seeded claim set to `MongoDB.claims` |
| Watcher | claim to `{paid, acquisition_cost, nadac, contract_rate}` to verdict |
| Evidence | verdict + state to statute citation + invoice PDF to evidence |
| Filing | evidence to PBM appeal spec to iMessage thread (Spectrum) |
| Negotiation | denial to diagnose to remediate (WhatsApp/SMS) to refile |
| Ledger | APPROVED to Nessie reversing bill + 25% contingency fee |
| Voice | settlement to ElevenLabs TTS to native voice message in thread |
| Dashboard | WebSocket stream of all state transitions and ledger balances |

### 5.3 Data contracts

**Claim**

```json
{
  "claim_id": "RXS-0001",
  "pharmacy_id": "PH-MEADOWBROOK",
  "ndc": "00378-0018-01",
  "qty": 1000,
  "plan": "TN Part D",
  "fill_date": "2026-03-14",
  "paid_amount": 6.40,
  "acquisition_cost": 12.80,
  "nadac": 11.95,
  "contract_rate": 7.10,
  "state": "TN",
  "pbm": "CAREFAKE"
}
```

**Watcher verdict**

```json
{
  "claim_id": "RXS-0001",
  "verdict": "UNDERWATER",
  "delta": 6.40,
  "benchmark_used": "acquisition_cost",
  "appeal_deadline": "2026-03-23",
  "confidence": 0.97
}
```

**Evidence packet**

```json
{
  "claim_id": "RXS-0001",
  "statute": "Tenn. Code Ann. 56-7-3206(c)(2)(B)(ii)",
  "entitlement": "PBM shall reimburse at actual acquisition cost when MAC falls below cost",
  "attachments": ["wholesaler_invoice_RXS-0001.pdf"],
  "required_fields_present": ["ndc", "invoice_date", "acquisition_cost", "wholesaler_attestation"],
  "completeness": 0.75
}
```

**Ledger settlement**

```json
{
  "event": "RECOVERY_SETTLED",
  "claim_id": "RXS-0001",
  "bills": [
    { "from": "PBM-CAREFAKE", "to": "PH-MEADOWBROOK", "amount": 6.40, "kind": "reversal" },
    { "from": "PH-MEADOWBROOK", "to": "RXSOLVE-PLATFORM", "amount": 1.60, "kind": "contingency_fee" }
  ]
}
```

## 6. Agent Architecture

Five components, five different levels of autonomy. The split is deliberate: more agentic where reasoning matters, deterministic where speed and reliability matter.

| Component | Autonomy model | Why |
|---|---|---|
| Orchestrator | Gates only | Sequencing and precondition checks must be exact. It never performs a recovery action itself. |
| Adjudication Watcher | Deterministic on the happy path | NADAC, acquisition cost, and contract rate is arithmetic: three numbers, one comparison. A model call adds latency, cost, and failure modes for zero reasoning gain. MARGINAL verdicts escalate to the agent, which is where judgment actually lives. |
| Evidence Builder | Fully agentic | Statute text is unstructured, jurisdiction-specific, and amended over time. Extracting "what does this state entitle this pharmacy to, and by how much" cannot be templated. No model, no product. |
| Filing & Negotiation | Deterministic filing, agentic negotiation | Filing is form-filling against a published spec; one wrong field name means a rejected appeal. Negotiation is judgment: reading a denial, diagnosing the cause, choosing remediate / escalate / abandon. Split the mode by task, not by component. |
| Voice Agent | Deterministic loop | Templated utterances with filled values: STT, reason, TTS. Open-ended voice generation is unpredictable and adds nothing to the demo. |

> **Determinism Rule.** The mock PBM's concession is rule-based on evidence completeness. No model decides whether to concede.
>
> A demo that hinges on a coin flip is a demo that dies on stage. A live denial followed by a deterministic win is more impressive than an easy yes, because it proves the loop handles failure.

## 7. The Agents

### 7.1 Adjudication Watcher

**Purpose.** Guarantee no claim resolves below cost without a verified recovery being opened.

**Capabilities.**

- NADAC benchmark lookup against a seeded fixture
- Acquisition-cost join from the wholesaler invoice store
- Contract-rate comparison
- Tolerance-band escalation (MARGINAL routes to the model, not to a guess)

```python
def adjudicate(claim, invoices, nadac, contract) -> Verdict:
    acq = acquisition_cost(invoices, claim["ndc"], claim["fill_date"])
    refs = [acq, nadac[claim["ndc"]], contract[claim["plan"], claim["ndc"]]]
    floor = min(refs)                      # most conservative reference
    delta = floor - claim["paid_amount"]
    if delta <= 0:
        return Verdict("CLEAR", delta=0.0)             # no model call on this path
    if delta <= MARGINAL_BAND_CENTS:
        return escalate_to_agent(claim, delta)         # judgment lives here
    return Verdict(
        "UNDERWATER",
        delta=delta,
        benchmark_used="acquisition_cost",
        appeal_deadline=deadline_for(claim["state"], claim["fill_date"]),
    )
```

### 7.2 Evidence Builder

**Purpose.** Convert a dollar delta into a filing that survives review.

**Capabilities.**

- Statute retrieval and entitlement extraction from the state's pharmacy-reimbursement act
- Citation formatting with section number and quoted entitlement language
- Wholesaler invoice line to signed PDF attachment
- Completeness scoring against the PBM's required-field list

```python
async def build_evidence(claim: Claim, verdict: Verdict) -> Evidence:
    statute = await retrieve_statute(claim["state"], topic="mac_appeal")
    entitlement = await extract_entitlement(
        statute, require="acquisition_cost_floor"
    )
    pdf = render_invoice_line(
        invoice=claim.source_invoice, ndc=claim["ndc"], lot=claim["lot"]
    )
    required = PBM_SPECS[claim["pbm"]].required_fields   # per-PBM spec
    present = check_present(claim, required)
    missing = [f for f in required if f not in present]
    return Evidence(
        claim_id=claim.claim_id,
        statute=statute.citation,
        entitlement=entitlement.text,
        attachments=[pdf],
        required_fields_present=present,
        completeness=1 - len(missing) / len(required),
        appeal_deadline=verdict.appeal_deadline,
    )
```

### 7.3 Filing & Negotiation Agent

**Purpose.** Win the claim inside the PBM's own conversation.

**Filing mode (deterministic).** Fill the PBM's published appeal spec exactly: field names, formats, required attestations. Post into the iMessage thread via Spectrum with the evidence PDF attached.

**Negotiation mode (agentic).** On denial, read the stated reason, classify it, and choose:

| Denial reason | Action |
|---|---|
| Missing required field | Remediate via WhatsApp/SMS to wholesaler, then refile |
| Disputed but evidence complete | Escalate citing the statute; request supervisor review |
| Appeal window expired | File external appeal with the state regulator |
| Claim not eligible | Abandon: log it, file nothing |

Self-correction is the demo. The agent must handle a live denial, not just a happy path.

```python
async def on_denial(claim_id: str, denial: Denial) -> Action:
    ev = await load_evidence(claim_id)
    if denial.reason == "missing_field":
        field = denial.field_name
        doc = await request_document_via_spectrum(
            channel="whatsapp",
            to=claim.wholesaler_contact,
            ask=field,
            attachment=ev.statute_excerpt,
        )
        await refile_in_thread(claim_id, doc)
        return Action("REFILLED", doc)
    if denial.reason == "disputed" and ev.completeness == 1.0:
        return await escalate_to_regulator(claim_id, citation=ev.statute)
    if denial.reason == "window_expired":
        return await file_external_appeal(claim_id, regulator=claim.state)
    return Action("ABANDONED", reason=denial.reason)
```

### 7.4 Voice Agent

**Purpose.** Close the loop with the human who owns the pharmacy.

**Capabilities.**

- Outbound: recovery summary as a native voice message in the iMessage thread
- Inbound (stretch): answer a live PBM call (STT, reason, TTS)

**Bounded loop.** Never open-ended generation; every utterance is templated with filled values. The model summarizes; it does not improvise.

```python
async def notify_recovery(claim: Claim, recovered: Decimal) -> None:
    total = await ledger.total_recovered(claim.pharmacy_id)
    text = (
        f"RxSolve: claim {claim.ndc} on {claim.fill_date} resolved "
        f"{recovered} dollars above cost. Appeal closed in "
        f"{claim.days_to_close} days. Recovered to date: {total} dollars."
    )
    audio = await elevenlabs.tts(text, voice=PHARMACIST_VOICE)
    await spectrum.send_voice_message(
        channel="imessage", audio=audio, text=text
    )
```

## 8. Orchestrator

Gates every transition. Refuses to spawn an agent whose precondition is not met.

```python
async def process_claim(claim_id: str) -> Outcome:
    claim = await db.claims.get(claim_id)

    # Gate 1 -- ledger reachable
    acct = await nessie.get_account(claim.pharmacy_id)
    if acct is None:
        return await halt_and_flag(claim_id, "no_ledger_account")

    # Phase 1 -- synchronous detection (no model on CLEAR)
    verdict = await adjudicate(claim)
    await db.claims.update(claim_id, {"verdict": verdict})
    if verdict.verdict == "CLEAR":
        return Outcome("CLEARED", delta=0)

    # Phase 2 -- evidence (fully agentic)
    evidence = await build_evidence(claim, verdict)

    # Phase 3 -- file into the live conversation
    filed = await file_appeal(claim, evidence)

    # Phase 4 -- negotiate (event-driven; may span minutes or hours)
    outcome = await await_resolution(claim_id, timeout=claim.deadline)
    if outcome.status != "APPROVED":
        return outcome

    # Phase 5 -- settle
    await settle_recovery(claim, evidence, fee_pct=0.25)
    await notify_recovery(claim, outcome.delta)
    return Outcome("RECOVERED", delta=outcome.delta)


DEADLINES = {"TN": 7, "default": 30}   # business days, per statute

def deadline_for(state, fill_date) -> date:
    return business_add(fill_date, DEADLINES.get(state, DEADLINES["default"]))
```

## 9. Data Layer

MongoDB stores everything that cannot live in a ledger or a message thread.

| Collection | Contents | Indexed |
|---|---|---|
| `claims` | Every adjudicated claim: paid vs. acquisition vs. NADAC vs. contract, verdict, state, PBM | `claim_id`, `{state, verdict}`, `fill_date` |
| `evidence` | Statute citation, entitlement text, invoice PDF ref, completeness score, required-field checklist | `claim_id`, `completeness` |
| `appeals` | Full dispute lifecycle: filing, denial reason, remediation, escalation, resolution | `claim_id`, `status`, `deadline` |
| `specs` | Per-PBM appeal form specs, required fields, submission formats, response SLAs | `pbm` |
| `statutes` | Per-state entitlement text, appeal windows, regulator contact and escalation address | `state` |
| `ledger_events` | Every Nessie movement: disbursement, reversal, contingency fee | `claim_id`, `pharmacy_id` |
| `transcript` | Full iMessage/WhatsApp/SMS thread per claim; the human-readable audit trail | `claim_id`, `ts` |
| `audit` | Append-only log of every agent spawn, gate decision, and state transition | `claim_id`, `ts` |

**Safety property.** `statutes` and `specs` are versioned. Every appeal records the exact rulebook version it was filed under. When a state amends its statute, previously-filed claims remain reproducible against the text that was in force at filing time.

## 10. Ledger

### 10.1 Capital One Nessie

Four real entities, created at boot:

| Entity | Role |
|---|---|
| `PH-MEADOWBROOK` | Pharmacy business account; receives reversals, pays fees |
| `PBM-CAREFAKE` | PBM; disburses claims, funds reversals |
| `RXSOLVE-PLATFORM` | Collects the 25% contingency fee |
| `PATIENT-*` | Patient accounts for terminal-flow realism |

**Every displayed dollar is a real movement.** Disbursement at adjudication, reversing bill on approval, fee transfer on settlement. The dashboard's "recovered to date" figure is a computed balance, not a stored counter.

```python
async def settle_recovery(claim: Claim, delta: Decimal, fee_pct: float = 0.25) -> None:
    # reversing bill: PBM returns what it underpaid
    await nessie.post_bill(
        from_=claim.pbm_account, to_=claim.pharmacy_account, amount=delta
    )
    # contingency fee: RxSolve takes its cut only on recovered money
    await nessie.post_bill(
        from_=claim.pharmacy_account,
        to_=PLATFORM_ACCOUNT,
        amount=round(delta * fee_pct, 2),
    )
    await db.ledger_events.insert_one(snapshot(claim, delta, fee_pct))
```

> **T+0 integration check: Nessie ships in two generations.**
>
> - **Classic:** `nessieisreal.com`, API key as a `?key=` query parameter, money moves via `POST /bills`.
> - **v2:** `/v2/accounts`, header-based authentication.
>
> MLH hands out one of them. Probe which one in the first ten minutes. The entire ledger layer depends on it, and nothing else in the build can be trusted until it is settled.

## 11. Dashboard

| Panel | Contents |
|---|---|
| Cashier Terminal | Patient queue, drug line items, live adjudication result. Shows RESOLVED ABOVE COST or an in-flight recovery badge. This is what makes it read as a payments product, not an appeals tool. |
| Live Recovery Feed | Cards appearing in real time as claims resolve: drug, delta, deadline countdown, status, link into the thread |
| Pipeline Board | Kanban across DETECTED, EVIDENCE, FILED, NEGOTIATING, SETTLED, plus ESCALATED and ABANDONED. Deadline clock visible per card. |
| Ledger Panel | Nessie account balances, recovered-to-date, fees accrued, link to full transaction record |
| Thread Viewer | The iMessage conversation per claim, rendered as it happens; the Photon proof surface |

## 12. Sponsor Integration Map

Each sponsor gets one designed moment, built against that sponsor's own judging criteria.

| Sponsor | Where it is used | Demo moment |
|---|---|---|
| Photon | Spectrum SDK binds the agent into iMessage as a real conversation partner. Same agent simultaneously on WhatsApp and SMS to chase the missing wholesaler attestation. Attachments, reactions, and human-in-the-loop approval used natively. | The PBM denies inside the iMessage thread. The agent reads it, works the claim, and replies in-thread while the pharmacist taps approve. |
| Nessie | Four accounts, disbursement at adjudication, reversing bill on approval, fee transfer on settlement. | The recovery visibly moves real balances between accounts, live on stage. |
| ElevenLabs | Self-implemented STT, AGENT_API_KEY, TTS loop. | A voice message confirming the recovery lands inside the iMessage thread: one moment satisfying two sponsors at once. |

## 13. Infrastructure

| Component | Tool | Notes |
|---|---|---|
| Agent runtime | Python 3.12 + FastAPI | Single service, async loop, WebSocket to dashboard |
| Agent model | `AGENT_API_KEY` | LLM of choice, chosen at runtime. Invoked only on MARGINAL, evidence extraction, and negotiation |
| Messaging | Photon Spectrum SDK (`spectrum-ts`) | iMessage primary; WhatsApp + SMS for wholesaler remediation. Use the SDK loop unless a public HTTPS URL already exists; webhooks require one. |
| Voice | ElevenLabs STT + TTS | Self-implemented loop. Do not depend on hosted Conversational AI; it requires a dashboard-configured agent. |
| Ledger | Capital One Nessie REST | Version probe at T+0 (see section 10) |
| Database | MongoDB Atlas free tier | Seeded with 60 claims, ~18 underwater |
| Frontend | Next.js + WebSocket | Four panels plus the cashier terminal |
| Tunnel | ngrok / Cloudflare Tunnel | Only if the webhook path is chosen for Spectrum |

## 14. Trust & Safety Model

This system makes financial claims and files legal appeals. Every safeguard below must be functional before the demo.

1. **The PBM concession is deterministic, never model-generated.** The mock PBM decides to concede on a rule: evidence completeness at or above threshold and all required fields present. If a model decides whether to concede, the demo becomes a coin flip on stage.
2. **Every appeal is reproducible from source documents.** Each appeal stores the invoice PDF, the statute text, the rulebook version, and the completeness score. A reviewer can reconstruct exactly why the claim was filed and why it should win. If we cannot reproduce it, we do not file it; the agent abandons and logs instead.
3. **No claim is filed without complete evidence.** Incomplete packets route to remediation or escalation. The system never files a weak appeal to manufacture activity. A low win rate dressed up as volume is the failure mode this rule exists to prevent.
4. **Abandonment is a first-class outcome.** ABANDONED claims are logged with reason and reported honestly on the dashboard. An agent that never gives up is an agent that will eventually file something indefensible.
5. **No PHI touches persistent storage or leaves the vault.** Synthetic patient data only. Claim records carry an opaque `patient_ref`: no names, no dates of birth, no real identifiers. This is a design property and it is worth saying out loud during the demo.
6. **The ledger is append-only.** No mutation of posted entries. Corrections post reversing entries. Every dollar movement is reconstructible.
