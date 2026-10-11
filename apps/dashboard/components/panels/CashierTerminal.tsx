"use client";
/** PMS mock / cashier terminal (UI-02, do not cut). Owner: P3. Submits a real B1 to the PBM Sim. */
import { useState } from "react";
import { Panel } from "@/components/ui/Panel";
import { Pill } from "@/components/ui/Pill";
import { queueStatus, type Tone } from "@/lib/claims";
import { type PanelProps, usd } from "./types";

const DEMO = {
  transaction: "B1",
  meta: { pbm: "PBM_PORTAL", pharmacy_id: "PH-MEADOWBROOK", state: "TN", plan: "TN Part D", patient_ref: "PT-7F3A" },
  request: { "407-D7": "00378001801", "442-E7": 1000, "405-D5": 30, "409-D9": 14.5, "426-DQ": 18.0 },
};

const PRESCRIPTIONS = [
  { id: "queue-01", patientRef: "PT-7F3A", drug: "Metformin HCl 500 mg tab", ndc: "00378001801", quantity: 1000, daysSupply: 30, submittedCost: 14.5, usualCharge: 18, serviceDate: "20261010" },
  { id: "queue-02", patientRef: "PT-91B2", drug: "Amlodipine 5 mg tab", ndc: "00781107210", quantity: 30, daysSupply: 30, submittedCost: 9, usualCharge: 14.5, serviceDate: "20261010" },
  { id: "queue-03", patientRef: "PT-C42D", drug: "Metformin HCl 500 mg tab", ndc: "00378001801", quantity: 90, daysSupply: 30, submittedCost: 1.3, usualCharge: 3.25, serviceDate: "20261010" },
] as const;

type Prescription = (typeof PRESCRIPTIONS)[number];
type NcpdpRequest = Record<string, string | number>;
type NcpdpResponse = Record<string, unknown>;
type Submission = { claimId: string; request: NcpdpRequest; response: NcpdpResponse };

const moneyValue = (value: unknown) => typeof value === "number" ? usd(value) : value == null ? "—" : String(value);

export function CashierTerminal({ live }: PanelProps) {
  const [selectedId, setSelectedId] = useState<string>(PRESCRIPTIONS[0]!.id);
  const [submissions, setSubmissions] = useState<Record<string, Submission>>({});
  const [submittingId, setSubmittingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const selected: Prescription = PRESCRIPTIONS.find((p) => p.id === selectedId) ?? PRESCRIPTIONS[0]!;
  const isSubmitting = submittingId !== null;

  const statusOf = (rx: Prescription) => {
    const sub = submissions[rx.id];
    return queueStatus({
      submitting: submittingId === rx.id,
      submitted: Boolean(sub),
      rejected: sub?.response["112-AN"] === "R",
      view: sub ? live.claims[sub.claimId] : undefined,
    });
  };

  const sub = submissions[selected.id];
  const view = sub ? live.claims[sub.claimId] : undefined;
  const acquisition = view?.claim.acquisition_cost;

  let line1 = "Ready to ring up";
  let line2 = "Send this claim to the PBM to see what it pays.";
  let badge: { label: string; tone: Tone } = { label: "READY", tone: "muted" };
  if (submittingId === selected.id) {
    line1 = "Sending claim to the PBM…";
    line2 = "";
    badge = { label: "SENDING", tone: "info" };
  } else if (sub) {
    const rejected = sub.response["112-AN"] === "R";
    line1 = rejected ? "PBM rejected the claim" : `PBM paid ${moneyValue(sub.response["509-F9"] ?? sub.response["506-F6"])}`;
    line2 = rejected
      ? `Reject code ${String(sub.response["511-FB"] ?? "—")}`
      : [
        `Ingredient paid ${moneyValue(sub.response["506-F6"])}`,
        `patient pays ${moneyValue(sub.response["505-F5"])}`,
        typeof acquisition === "number" ? `drug cost ${usd(acquisition)}` : null,
      ].filter(Boolean).join(" · ");
    const stage = view?.stage;
    if (rejected) badge = { label: "REJECTED BY PBM", tone: "bad" };
    else if (stage === "SETTLED" || stage === "CLEARED") badge = { label: "RESOLVED ABOVE COST", tone: "good" };
    else if (stage === "EXCEPTION") badge = { label: "WAITING FOR PHARMACIST", tone: "bad" };
    else if (stage) badge = { label: "RECOVERY IN FLIGHT", tone: "warn" };
    else if (view?.verdict && view.verdict.verdict !== "CLEAR") badge = { label: "PAID BELOW COST", tone: "bad" };
    else badge = { label: "CLAIM PAID · AWAITING LIVE STATUS", tone: "muted" };
  }

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

    setSubmittingId(selected.id);
    setError(null);
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
      setSubmissions((prev) => ({ ...prev, [selected.id]: { claimId: id, request, response: payload.response as NcpdpResponse } }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to submit the claim.");
    } finally {
      setSubmittingId(null);
    }
  }

  return (
    <Panel
      id="cashier"
      title="Cashier terminal"
      aside={<span className="mock-tag">PHARMACY SYSTEM · MOCK</span>}
      className="cashier"
    >
      <ol className="plain queue" aria-label="Dispensing queue">
        {PRESCRIPTIONS.map((rx) => {
          const status = statusOf(rx);
          return (
            <li key={rx.id}>
              <button
                type="button"
                className="row-button queue__row"
                aria-pressed={selected.id === rx.id}
                aria-label={`Select ${rx.drug}, patient reference ${rx.patientRef}, quantity ${rx.quantity}`}
                disabled={isSubmitting}
                onClick={() => setSelectedId(rx.id)}
              >
                <span className="mono muted">{rx.patientRef}</span>
                <span>
                  <strong className="row-title">{rx.drug}</strong>
                  <small className="muted">qty {rx.quantity} · {rx.daysSupply}-day supply</small>
                </span>
                <Pill tone={status.tone}>{status.label}</Pill>
              </button>
            </li>
          );
        })}
      </ol>

      <div className="stat-pair">
        <div><small>Ingredient cost submitted</small><b className="money">{usd(selected.submittedCost)}</b></div>
        <div><small>Usual &amp; customary charge</small><b className="money">{usd(selected.usualCharge)}</b></div>
      </div>

      <button type="button" className="btn btn--wide" onClick={submit} disabled={isSubmitting}>
        {isSubmitting ? "Sending to PBM…" : "Ring up claim"}
      </button>

      <div className="response-box" role="status" aria-live="polite" aria-atomic="true" aria-busy={isSubmitting}>
        <div className="eyebrow">PBM response</div>
        <div className="response-box__main">{line1}</div>
        {line2 && <div className="response-box__sub">{line2}</div>}
        <Pill tone={badge.tone} big>{badge.label}</Pill>
      </div>
      {error && <p className="error-text" role="alert">Claim submission failed: {error}</p>}

      {sub && (
        <details className="ncpdp">
          <summary>NCPDP B1 request and response · {sub.claimId}</summary>
          <div className="ncpdp__grid">
            <dl>
              <dt className="muted">401-D1 · Service date</dt><dd className="money">{String(sub.request["401-D1"])}</dd>
              <dt className="muted">402-D2 · Rx reference</dt><dd className="money">{String(sub.request["402-D2"])}</dd>
              <dt className="muted">407-D7 · Product ID</dt><dd className="money">{String(sub.request["407-D7"])}</dd>
              <dt className="muted">442-E7 · Quantity</dt><dd className="money">{String(sub.request["442-E7"])}</dd>
              <dt className="muted">405-D5 · Days supply</dt><dd className="money">{String(sub.request["405-D5"])}</dd>
              <dt className="muted">409-D9 · Ingredient cost</dt><dd className="money">{moneyValue(sub.request["409-D9"])}</dd>
              <dt className="muted">426-DQ · U&amp;C charge</dt><dd className="money">{moneyValue(sub.request["426-DQ"])}</dd>
            </dl>
            <dl>
              <dt className="muted">112-AN · Transaction status</dt><dd className="money">{String(sub.response["112-AN"] ?? "—")}</dd>
              <dt className="muted">506-F6 · Ingredient paid</dt><dd className="money">{moneyValue(sub.response["506-F6"])}</dd>
              <dt className="muted">505-F5 · Patient pay</dt><dd className="money">{moneyValue(sub.response["505-F5"])}</dd>
              <dt className="muted">509-F9 · Total paid</dt><dd className="money">{moneyValue(sub.response["509-F9"])}</dd>
              <dt className="muted">511-FB · Reject code</dt><dd className="money">{String(sub.response["511-FB"] ?? "—")}</dd>
            </dl>
          </div>
        </details>
      )}
    </Panel>
  );
}
