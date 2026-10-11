"use client";
/** PMS mock / cashier terminal (UI-02, do not cut). Owner: P3. */
import { useState } from "react";
import { type PanelProps, usd } from "./types";

const DEMO = {
  transaction: "B1",
  meta: { pbm: "PBM_PORTAL", pharmacy_id: "PH-MEADOWBROOK", state: "TN", plan: "TN Part D", patient_ref: "PT-7F3A" },
  request: { "407-D7": "00378001801", "442-E7": 1000, "405-D5": 30, "409-D9": 14.5, "426-DQ": 18.0 },
};

const PRESCRIPTIONS = [
  {
    id: "queue-01",
    patientRef: "PT-7F3A",
    drug: "Metformin HCl 500 mg tab",
    ndc: "00378001801",
    quantity: 1000,
    daysSupply: 30,
    submittedCost: 14.5,
    usualCharge: 18,
    serviceDate: "20261010",
  },
  {
    id: "queue-02",
    patientRef: "PT-91B2",
    drug: "Amlodipine 5 mg tab",
    ndc: "00781107210",
    quantity: 30,
    daysSupply: 30,
    submittedCost: 9,
    usualCharge: 14.5,
    serviceDate: "20261010",
  },
  {
    id: "queue-03",
    patientRef: "PT-C42D",
    drug: "Metformin HCl 500 mg tab",
    ndc: "00378001801",
    quantity: 90,
    daysSupply: 30,
    submittedCost: 1.3,
    usualCharge: 3.25,
    serviceDate: "20261010",
  },
] as const;

type Prescription = (typeof PRESCRIPTIONS)[number];
type NcpdpRequest = Record<string, string | number>;
type NcpdpResponse = Record<string, unknown>;
type Submission = {
  claimId: string;
  prescription: Prescription;
  request: NcpdpRequest;
  response: NcpdpResponse;
};

const moneyValue = (value: unknown) => typeof value === "number" ? usd(value) : value == null ? "—" : String(value);

export function CashierTerminal({ live }: PanelProps) {
  const [selectedId, setSelectedId] = useState<string>(PRESCRIPTIONS[0]!.id);
  const [submission, setSubmission] = useState<Submission | null>(null);
  const [claimId, setClaimId] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const selected = PRESCRIPTIONS.find((prescription) => prescription.id === selectedId) ?? PRESCRIPTIONS[0]!;
  const view = claimId ? live.claims[claimId] : undefined;
  const responseStatus = submission?.response["112-AN"];
  const badge = view?.stage
    ? view.stage === "CLEARED" || view.stage === "SETTLED"
      ? "RESOLVED ABOVE COST"
      : "RECOVERY IN FLIGHT"
    : responseStatus === "R"
      ? "REJECTED BY PBM"
      : submission
        ? "CLAIM PAID · AWAITING LIVE STATUS"
        : null;

  async function submit() {
    const rx = String(Math.floor(1_000_000 + Math.random() * 8_999_999));
    const id = `RXS-${rx}`;
    const request: NcpdpRequest = {
      "401-D1": selected.serviceDate,
      "402-D2": rx,
      ...DEMO.request,
      "407-D7": selected.ndc,
      "442-E7": selected.quantity,
      "405-D5": selected.daysSupply,
      "409-D9": selected.submittedCost,
      "426-DQ": selected.usualCharge,
    };

    setIsSubmitting(true);
    setError(null);
    setSubmission(null);
    setClaimId(null);

    try {
      const result = await fetch("/sim/switch/claim", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ...DEMO,
          meta: { ...DEMO.meta, patient_ref: selected.patientRef, claim_id: id },
          request,
        }),
      });
      const payload = await result.json() as { response?: unknown; error?: unknown };
      if (!result.ok) {
        throw new Error(typeof payload.error === "string" ? payload.error : `PBM Sim returned ${result.status}.`);
      }
      if (!payload.response || typeof payload.response !== "object" || Array.isArray(payload.response)) {
        throw new Error("PBM Sim returned an invalid NCPDP response.");
      }
      setSubmission({
        claimId: id,
        prescription: selected,
        request,
        response: payload.response as NcpdpResponse,
      });
      setClaimId(id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to submit the claim.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <section className="panel cashier-terminal" aria-labelledby="cashier-terminal-title" aria-busy={isSubmitting}>
      <header className="cashier-header" style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
        <h2 id="cashier-terminal-title" style={{ margin: 0 }}>Cashier terminal</h2>
        <span className="pill">PMS MOCK</span>
        <span className="muted" style={{ marginLeft: "auto" }}>PH-MEADOWBROOK · PBM_PORTAL</span>
      </header>

      <div className="cashier-workspace" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 280px), 1fr))", gap: 14 }}>
        <section className="cashier-queue-panel" aria-labelledby="cashier-queue-title">
          <h3 id="cashier-queue-title" style={{ margin: "0 0 8px", fontSize: 14 }}>Dispensing queue <span className="muted">· {PRESCRIPTIONS.length} prescriptions</span></h3>
          <ol className="plain cashier-queue">
            {PRESCRIPTIONS.map((prescription, index) => (
              <li key={prescription.id}>
                <button
                  type="button"
                  className="cashier-queue-item"
                  aria-pressed={selected.id === prescription.id}
                  aria-label={`Select ${prescription.drug}, patient reference ${prescription.patientRef}, quantity ${prescription.quantity}`}
                  disabled={isSubmitting}
                  onClick={() => setSelectedId(prescription.id)}
                  style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "2px 9px", width: "100%", textAlign: "left" }}
                >
                  <span className="cashier-queue-number muted">0{index + 1}</span>
                  <strong>{prescription.drug}</strong>
                  <span className="cashier-patient-ref muted" style={{ gridColumn: 2 }}>patient_ref · {prescription.patientRef}</span>
                  <span className="cashier-quantity muted" style={{ gridColumn: 2 }}>Qty {prescription.quantity} · {prescription.daysSupply} days</span>
                </button>
              </li>
            ))}
          </ol>
        </section>

        <section className="cashier-prescription" aria-labelledby="cashier-prescription-title">
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
            <div>
              <h3 id="cashier-prescription-title" style={{ margin: "0 0 4px", fontSize: 16 }}>{selected.drug}</h3>
              <div className="muted">patient_ref <span className="cashier-patient-ref">{selected.patientRef}</span></div>
            </div>
            <span className="pill">READY TO BILL</span>
          </div>
          <dl className="cashier-prescription-details" style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: "5px 12px", margin: "12px 0" }}>
            <dt className="muted">Product / service ID</dt><dd className="money" style={{ margin: 0 }}>{selected.ndc}</dd>
            <dt className="muted">Quantity dispensed</dt><dd className="money" style={{ margin: 0 }}>{selected.quantity}</dd>
            <dt className="muted">Days supply</dt><dd className="money" style={{ margin: 0 }}>{selected.daysSupply}</dd>
            <dt className="muted">Ingredient cost submitted</dt><dd className="money" style={{ margin: 0 }}>{usd(selected.submittedCost)}</dd>
            <dt className="muted">Usual & customary charge</dt><dd className="money" style={{ margin: 0 }}>{usd(selected.usualCharge)}</dd>
          </dl>
          <button type="button" className="cashier-submit" onClick={submit} disabled={isSubmitting}>
            {isSubmitting ? "Submitting B1…" : "Submit B1 claim"}
          </button>
        </section>
      </div>

      <div className="cashier-claim-status" role="status" aria-live="polite" aria-atomic="true" style={{ marginTop: 12 }}>
        {isSubmitting ? (
          <span className="pill">SUBMITTING · SENDING TO PBM SIM</span>
        ) : badge ? (
          <span className="pill">{badge}{view?.stage ? ` · ${view.stage}` : ""}</span>
        ) : (
          <span className="muted">No claim submitted yet.</span>
        )}
      </div>
      {error && <p className="cashier-error" role="alert">Claim submission failed: {error}</p>}

      {submission && (
        <section className="cashier-transaction" aria-labelledby="cashier-transaction-title" style={{ marginTop: 12 }}>
          <h3 id="cashier-transaction-title" style={{ margin: "0 0 8px", fontSize: 14 }}>
            Latest B1 transaction <span className="muted">· {submission.claimId} · patient_ref {submission.prescription.patientRef}</span>
          </h3>
          <div className="cashier-transaction-details" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(230px, 1fr))", gap: 12 }}>
            <section className="cashier-request" aria-labelledby="cashier-request-title">
              <h4 id="cashier-request-title" className="muted" style={{ margin: "0 0 6px", fontSize: 12 }}>NCPDP request · B1</h4>
              <dl style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: "4px 10px", margin: 0 }}>
                <dt className="muted">401-D1 · Service date</dt><dd className="money" style={{ margin: 0 }}>{submission.request["401-D1"]}</dd>
                <dt className="muted">402-D2 · Rx reference</dt><dd className="money" style={{ margin: 0 }}>{submission.request["402-D2"]}</dd>
                <dt className="muted">407-D7 · Product ID</dt><dd className="money" style={{ margin: 0 }}>{submission.request["407-D7"]}</dd>
                <dt className="muted">442-E7 · Quantity</dt><dd className="money" style={{ margin: 0 }}>{submission.request["442-E7"]}</dd>
                <dt className="muted">405-D5 · Days supply</dt><dd className="money" style={{ margin: 0 }}>{submission.request["405-D5"]}</dd>
                <dt className="muted">409-D9 · Ingredient cost</dt><dd className="money" style={{ margin: 0 }}>{moneyValue(submission.request["409-D9"])}</dd>
                <dt className="muted">426-DQ · U&C charge</dt><dd className="money" style={{ margin: 0 }}>{moneyValue(submission.request["426-DQ"])}</dd>
              </dl>
            </section>
            <section className="cashier-response" aria-labelledby="cashier-response-title">
              <h4 id="cashier-response-title" className="muted" style={{ margin: "0 0 6px", fontSize: 12 }}>NCPDP response</h4>
              <dl style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: "4px 10px", margin: 0 }}>
                <dt className="muted">112-AN · Transaction status</dt><dd className="money" style={{ margin: 0 }}>{String(submission.response["112-AN"] ?? "—")}</dd>
                <dt className="muted">506-F6 · Ingredient paid</dt><dd className="money" style={{ margin: 0 }}>{moneyValue(submission.response["506-F6"])}</dd>
                <dt className="muted">505-F5 · Patient pay</dt><dd className="money" style={{ margin: 0 }}>{moneyValue(submission.response["505-F5"])}</dd>
                <dt className="muted">509-F9 · Total paid</dt><dd className="money" style={{ margin: 0 }}>{moneyValue(submission.response["509-F9"])}</dd>
                <dt className="muted">511-FB · Reject code</dt><dd className="money" style={{ margin: 0 }}>{String(submission.response["511-FB"] ?? "—")}</dd>
              </dl>
            </section>
          </div>
        </section>
      )}
    </section>
  );
}
