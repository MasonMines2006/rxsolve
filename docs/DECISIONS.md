# Decisions

Running log of decisions and contract changes. One entry per line: date, decision, why. Newest at the bottom.

| Date | Decision | Why |
|---|---|---|
| 2026-10-10 | Design doc split into `docs/` markdown files; docs are living and updated with code | Keep agents and teammates aligned on one source of truth |
| 2026-10-10 | Work directly on `main`, commit small and often, no worktrees | Hackathon pace; phases own discrete files |
| 2026-10-10 | Drop the "PBM persona in an iMessage thread" model; PBMs become a standalone PBM Sim with realistic intake channels | No real PBM takes appeals over iMessage; the old model bent the domain around the sponsor |
| 2026-10-10 | Three PBM personas modeled on CVS Caremark, Express Scripts, OptumRx public procedures; channels portal, email, fax | Shows channel-agnostic agent; modeling is a demo talking point; channel mix is our design choice pending RES-01 |
| 2026-10-10 | iMessage becomes the pharmacist channel: daily digest, exception pings, standing authorization | Claim volume is high; per-claim texts would flood; policy plus digest scales |
| 2026-10-10 | Fax is mocked inside PBM Sim | Bandwidth offers T.38 SIP only, no fax API; real fax provider is out of scope for 12 hours |
| 2026-10-10 | Phone negotiation is a stretch goal, built after the three core channels | Highest build risk; has simulated-rep and recorded fallbacks |
| 2026-10-10 | Nessie settlement modeled as remittance deposit plus fee transfer, not "reversing bills" | Matches how PBMs actually adjust payment; bills remain the fallback if transfers are unavailable |
