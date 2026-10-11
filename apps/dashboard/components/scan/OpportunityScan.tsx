"use client";

import { useState } from "react";
import { Panel } from "@/components/ui/Panel";
import {
  readyClaimIds,
  scanStatusPresentation,
  type OpportunityScanResult,
} from "@/lib/opportunityScan";

const usd = (value: number) => value.toLocaleString("en-US", { style: "currency", currency: "USD" });

export function OpportunityScan() {
  const [result, setResult] = useState<OpportunityScanResult | null>(null);
  const [sourceName, setSourceName] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [staged, setStaged] = useState(false);

  async function analyze(csv: string, name: string) {
    setPending(true);
    setError(null);
    setStaged(false);
    try {
      const response = await fetch("/api/opportunity-scan", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ csv }),
      });
      const body = await response.json().catch(() => null) as OpportunityScanResult | { error?: string } | null;
      if (!response.ok || !body || !("claims" in body)) {
        throw new Error(body && "error" in body && body.error ? body.error : "The scan could not be completed.");
      }
      setResult(body);
      setSourceName(name);
    } catch (cause) {
      setResult(null);
      setSourceName(null);
      setError(cause instanceof Error ? cause.message : "The scan could not be completed.");
    } finally {
      setPending(false);
    }
  }

  async function analyzeExample() {
    setPending(true);
    setError(null);
    try {
      const response = await fetch("/sample-claims.csv");
      if (!response.ok) throw new Error("The example CSV could not be loaded.");
      await analyze(await response.text(), "RxSolve example claims");
    } catch (cause) {
      setPending(false);
      setError(cause instanceof Error ? cause.message : "The example CSV could not be loaded.");
    }
  }

  async function chooseFile(file: File | undefined) {
    if (!file) return;
    if (file.size > 1_000_000) {
      setError("Choose a CSV that is 1 MB or smaller.");
      return;
    }
    await analyze(await file.text(), file.name);
  }

  const readyIds = result ? readyClaimIds(result.claims) : [];

  return (
    <div className="scan-flow">
      <Panel id="scan-intro" title="Historical recovery scan" aside="Your claim data stays in the scan">
        <div className="scan-intro">
          <div>
            <p className="scan-kicker">Find the recoverable losses already hiding in your claims.</p>
            <p className="scan-copy">Try the example file or choose a pharmacy claims export. RxSolve checks the shortfall, evidence, and filing deadline for every claim.</p>
          </div>
          <div className="scan-actions">
            <button className="btn" type="button" onClick={() => void analyzeExample()} disabled={pending}>
              {pending ? "Checking claims..." : "Use example CSV"}
            </button>
            <label className="btn btn--ghost scan-file">
              Choose a CSV
              <input
                type="file"
                accept=".csv,text/csv"
                disabled={pending}
                onChange={(event) => void chooseFile(event.target.files?.[0])}
              />
            </label>
          </div>
        </div>
        {error && <p className="scan-error" role="alert">Scan stopped: {error}</p>}
      </Panel>

      {result && (
        <>
          <section className="scan-summary" aria-label="Opportunity summary">
            <div className="scan-metric scan-metric--hero">
              <span>Ready to recover</span>
              <strong>{usd(result.summary.ready_to_recover)}</strong>
              <small>{result.summary.ready_claims} claims have complete evidence and an open deadline</small>
            </div>
            <div className="scan-metric">
              <span>Total shortfall found</span>
              <strong>{usd(result.summary.total_shortfall)}</strong>
              <small>{result.summary.underpaid_claims} of {result.summary.claims_scanned} claims were underpaid</small>
            </div>
            <div className="scan-metric">
              <span>Estimated pharmacy net</span>
              <strong>{usd(result.summary.estimated_pharmacy_net)}</strong>
              <small>after an estimated {usd(result.summary.estimated_fee)} RxSolve fee</small>
            </div>
          </section>

          <Panel
            id="scan-triage"
            title="Triage"
            aside={`${sourceName} · ${result.parser.mode === "llm_assisted" ? "columns matched automatically" : "standard column match"}`}
          >
            <div className="scan-buckets" aria-label="Claim categories">
              <span><b>{result.summary.ready_claims}</b> ready</span>
              <span><b>{result.summary.needs_review_claims}</b> need review</span>
              <span><b>{result.summary.missing_data_claims}</b> missing evidence</span>
              <span><b>{result.summary.expired_claims}</b> expired</span>
              <span><b>{result.summary.paid_fairly_claims}</b> paid fairly</span>
            </div>

            <div className="scan-table-wrap">
              <table className="scan-table">
                <thead>
                  <tr><th>Claim</th><th>Drug</th><th>PBM</th><th>Paid</th><th>Cost</th><th>Shortfall</th><th>Decision</th></tr>
                </thead>
                <tbody>
                  {result.claims.map((claim) => {
                    const presentation = scanStatusPresentation(claim.status);
                    return (
                      <tr key={claim.claim_id}>
                        <td className="mono">{claim.claim_id}</td>
                        <td><strong>{claim.drug}</strong><small>{claim.state} · deadline {claim.appeal_deadline}</small></td>
                        <td>{claim.pbm.replace("PBM_", "PBM ")}</td>
                        <td>{usd(claim.total_paid)}</td>
                        <td>{usd(claim.acquisition_cost)}</td>
                        <td className={claim.shortfall > 0 ? "tone-bad" : "tone-muted"}>{usd(claim.shortfall)}</td>
                        <td><span className={`scan-status scan-status--${presentation.tone}`}>{presentation.label}</span><small>{claim.reason}</small></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="scan-stage">
              <div>
                <strong>{staged ? `${readyIds.length} claims staged for policy review` : "Nothing will be filed yet"}</strong>
                <p>{staged ? "Next, the pharmacist chooses the dollar limit and approval rules." : "Review the deterministic triage before handing eligible claims to RxSolve."}</p>
              </div>
              <button className="btn" type="button" disabled={!readyIds.length || staged} onClick={() => setStaged(true)}>
                {staged ? "Ready for policy setup" : `Stage ${readyIds.length} ready claims`}
              </button>
            </div>
          </Panel>

          <Panel id="scan-safety" title="How the scan handles your file">
            <div className="scan-safety">
              <div><b>1. Matches columns</b><span>RxSolve can match unfamiliar column names without sharing claim rows or dollar amounts.</span></div>
              <div><b>2. Uses a fixed format</b><span>Every column must match one of eleven supported fields.</span></div>
              <div><b>3. Applies the same rules</b><span>Code checks the amounts, deadlines, evidence, and final totals.</span></div>
            </div>
          </Panel>
        </>
      )}
    </div>
  );
}
