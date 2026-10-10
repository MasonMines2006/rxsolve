# RxSolve: Tickets

Part of the technical design. See [DESIGN.md](DESIGN.md) for architecture and [BUILD_PLAN.md](BUILD_PLAN.md) for the schedule and shared `.env`.

| Phase | Tickets |
|---|---|
| P1 | INF-01 to INF-06 |
| P2 | AGT-01 to AGT-05 |
| P3 | UI-01 to UI-06 |

## P1: Infrastructure & Ledger

### INF-01 | T+0 to T+1 | Sponsor key sprint (all three)

Get all three sponsor APIs answering before anything else is built. This is the foundation; nobody can test until it is green.

```bash
# --- Nessie: probe the version FIRST ---
curl "https://api.nessieisreal.com/customers?key=$NESSIE_KEY"
# 401 or 404 => you are on v2. Switch to header auth against /v2/accounts

# --- ElevenLabs: one TTS call ---
curl -X POST "https://api.elevenlabs.io/v1/text-to-speech/$VOICE_ID" \
  -H "xi-api-key: $ELEVENLABS_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"text":"RxSolve online","model_id":"eleven_turbo_v2_5"}' \
  --output probe.mp3

# --- Photon: connect iMessage via the Spectrum dashboard ---
# Record the workspace URL in group chat before proceeding.
```

**Done when:** all three return success. Group chat has every key, the confirmed Nessie version, and the Spectrum workspace URL.

### INF-02 | T+1 to T+2 | FastAPI service, MongoDB, WebSocket

You are everyone's foundation.

```python
from fastapi import FastAPI, WebSocket
from pymongo import MongoClient

app = FastAPI()
db = MongoClient(os.environ["MONGO_URI"]).rxsolve
db.claims.create_index("claim_id", unique=True)
db.claims.create_index([("state", 1), ("verdict", 1)])
db.appeals.create_index([("status", 1), ("deadline", 1)])

@app.get("/api/health")
def health():
    return {"status": "ok"}

@app.websocket("/ws/live")
async def live(ws: WebSocket):
    await ws.accept()
    async for event in event_stream():
        await ws.send_json(event)
```

**Done when:** `curl localhost:8000/api/health` returns 200, and a WebSocket client receives events.

### INF-03 | T+2 to T+3 | Mock PBM adjudication engine + seed

Deterministic.

```python
def adjudicate(claim) -> Reimbursement:
    price = MAC_LIST.get(claim.ndc, claim.paid_amount)
    copay = COPAY_SCHEDULE[claim.plan](price)
    return Reimbursement(
        paid=round(max(price - copay, 0), 2),
        pbm=claim.pbm,
        adjudicated_at=now(),
    )
```

Seed 60 claims: ~18 UNDERWATER (MAC below acquisition cost), the remainder CLEAR, and 3 deliberately MARGINAL.

**Done when:** seeded claims adjudicate on load, the underwater count matches, and every claim has a `fill_date` inside its appeal window.

### INF-04 | T+3 to T+4 | Nessie ledger: accounts and settlement

Real balances.

```python
async def settle_recovery(claim, delta, fee_pct=0.25):
    await nessie.post_bill(from_=claim.pbm_account,
                           to_=claim.pharmacy_account, amount=delta)
    await nessie.post_bill(from_=claim.pharmacy_account,
                           to_=PLATFORM_ACCOUNT,
                           amount=round(delta * fee_pct, 2))
```

**Done when:** four accounts exist, a test reversal moves a real balance, and the fee transfer posts.

### INF-05 | T+4 to T+6 | Orchestrator + deadline clock

The demo's spine. Copy the loop from DESIGN.md section 8 exactly.

```python
DEADLINES = {"TN": 7, "default": 30}   # business days, per statute

def deadline_for(state, fill_date):
    return business_add(fill_date, DEADLINES.get(state, DEADLINES["default"]))
```

**Done when:** a CLEAR claim short-circuits; an UNDERWATER claim walks evidence then file; the clock counts down correctly in the dashboard feed.

### INF-06 | T+7 to T+9 | Escalation path + concession rules

No model in the loop.

```python
def adjudicate_appeal(evidence) -> Decision:
    if evidence.completeness >= 1.0:
        return Decision("APPROVED")
    if evidence.completeness >= 0.75:
        return Decision("DENIED", reason="missing_field",
                        field=first_missing(evidence))
    return Decision("DENIED", reason="insufficient_evidence")
```

**Done when:** a complete packet wins, a partial packet denies with a specific named field, and escalation files correctly.

## P2: Agents & Messaging

### AGT-01 | T+1 to T+3 | Adjudication Watcher

Deterministic on the happy path.

```python
def adjudicate(claim, invoices, nadac, contract):
    acq = acquisition_cost(invoices, claim["ndc"], claim["fill_date"])
    floor = min(acq, nadac[claim["ndc"]], contract[claim["plan"], claim["ndc"]])
    delta = floor - claim["paid_amount"]
    if delta <= 0:
        return Verdict("CLEAR", 0.0)
    if delta <= MARGINAL_BAND:
        return escalate_to_agent(claim, delta)
    return Verdict("UNDERWATER", delta)
```

**Done when:** a known-underwater claim returns UNDERWATER with the correct delta; a fair claim returns CLEAR with no model call.

### AGT-02 | T+3 to T+5 | Evidence Builder

Fully agentic.

```python
statute = await retrieve_statute(claim["state"], topic="mac_appeal")
text = await extract_entitlement(statute, require="acquisition_cost_floor")
pdf = render_invoice_line(claim.source_invoice, claim["ndc"])
```

**Done when:** a real appeal PDF exists with a correct section citation and a valid attached invoice for at least three different states.

### AGT-03 | T+5 to T+7 | Spectrum iMessage integration

Verify the API shape early.

Choose one path and commit. Webhooks need a public HTTPS URL plus signature verification and a tunnel. The SDK loop needs a long-lived process but no public URL. For a 12-hour build the SDK loop is usually lower friction.

```python
from spectrum import Spectrum

spectrum = Spectrum(api_key=os.environ["PHOTON_API_KEY"])

@spectrum.on_message
async def handle(msg):
    claim = match_claim_to_thread(msg)
    return await negotiation_agent.on_denial(claim, parse_denial(msg))
```

Bind the agent to iMessage (primary). Add WhatsApp + SMS for wholesaler remediation; multi-platform depth is exactly what Photon's judging rewards.

**Done when:** a message sent from a real phone into the thread produces an agent reply within five seconds.

### AGT-04 | T+7 to T+9 | Negotiation loop with live remediation

The demo beat.

```python
if denial.reason == "missing_field":
    doc = await spectrum.request_document(
        channel="whatsapp",
        to=claim.wholesaler_contact,
        ask=denial.field_name,
    )
    await refile_in_thread(claim.claim_id, doc)
```

**Done when:** the full deny, remediate, refile, approve sequence runs live without intervention.

### AGT-05 | T+9 to T+10 | ElevenLabs voice agent

Self-implemented loop. Do not depend on hosted Conversational AI.

```python
audio = await elevenlabs.tts(text, voice=PHARMACIST_VOICE)
await spectrum.send_voice_message(channel="imessage", audio=audio, text=text)
```

**Done when:** a native voice message lands in the thread on settlement, and the STT leg handles one inbound test call.

## P3: Dashboard & Demo

### UI-01 | T+3 to T+5 | Next.js shell + WebSocket client

Structure over polish. Four panels rendering live data. The demo is four minutes.

**Done when:** all four panels receive and render events from `/ws/live`.

### UI-02 | T+5 to T+7 | Cashier terminal

Do not cut this one. Patient queue, pay, adjudication result. This panel is what makes the project read as a payments company rather than an appeals tool.

**Done when:** a test claim flows through the terminal end to end and renders a resolved badge.

### UI-03 | T+7 to T+9 | Recovery feed, pipeline board, ledger panel

Real numbers only. Kanban with visible deadline countdowns. The ledger panel pulls real Nessie balances; every number traced to a real movement.

**Done when:** every dollar shown on screen is reproducible in the Nessie transaction record.

### UI-04 | T+9 to T+10 | Thread viewer

The Photon proof surface. Renders the iMessage conversation per claim as it happens. Judges need to see the agent conversing, not just a status badge.

**Done when:** the thread renders live, message by message, during a full run-through.

### UI-05 | T+10 to T+11 | Demo gate

Go / no-go. Full run-through, twice, timed. Cut everything that is not green.

**Done when:** two consecutive clean run-throughs with no manual intervention and no placeholder data.

### UI-06 | T+11 to T+12 | Submission assets

Own the paperwork. README, screenshots, demo recording, and each sponsor-prize checklist verified against that challenge's stated submission requirements. MLH pre-submission form filed before 11:59 PM.

**Done when:** form submitted, checklist verified per sponsor, recording backed up.
