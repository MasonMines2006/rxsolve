export type ScanStatus = "READY" | "PAID_FAIRLY" | "NEEDS_REVIEW" | "MISSING_DATA" | "EXPIRED";

export const MINIMUM_SCAN_DURATION_MS = 1_200;

export function remainingScanDelay(startedAt: number, now = Date.now()): number {
  return Math.max(0, MINIMUM_SCAN_DURATION_MS - (now - startedAt));
}

export const EXAMPLE_SCANS = [
  {
    id: "mixed",
    name: "Mixed claim outcomes",
    description: "Ready, review, missing evidence, expired, and fairly paid claims.",
    path: "/sample-claims.csv",
  },
  {
    id: "high-recovery",
    name: "High recovery opportunity",
    description: "Six complete claims with larger recoverable shortfalls.",
    path: "/sample-high-recovery.csv",
  },
  {
    id: "missing-evidence",
    name: "Missing invoice evidence",
    description: "Claims that need invoice details before they can move forward.",
    path: "/sample-missing-evidence.csv",
  },
  {
    id: "deadline-risk",
    name: "Deadline risk",
    description: "A mix of urgent open deadlines and claims that are already late.",
    path: "/sample-deadline-risk.csv",
  },
  {
    id: "alternate-export",
    name: "Different column names",
    description: "A pharmacy export that uses common aliases instead of RxSolve labels.",
    path: "/sample-alternate-export.csv",
  },
] as const;

type StatusTone = "good" | "muted" | "warn" | "bad";

export function scanStatusPresentation(status: ScanStatus): { label: string; tone: StatusTone } {
  switch (status) {
    case "READY": return { label: "Ready for RxSolve", tone: "good" };
    case "PAID_FAIRLY": return { label: "Paid fairly", tone: "muted" };
    case "NEEDS_REVIEW": return { label: "Needs review", tone: "warn" };
    case "MISSING_DATA": return { label: "Missing evidence", tone: "warn" };
    case "EXPIRED": return { label: "Deadline expired", tone: "bad" };
  }
}

export function readyClaimIds(claims: Array<{ claim_id: string; status: ScanStatus }>): string[] {
  return claims.filter((claim) => claim.status === "READY").map((claim) => claim.claim_id);
}

export type OpportunityScanResult = {
  parser: {
    mode: "deterministic" | "llm_assisted";
    mapped_headers: Record<string, string>;
  };
  summary: {
    claims_scanned: number;
    underpaid_claims: number;
    ready_claims: number;
    needs_review_claims: number;
    missing_data_claims: number;
    expired_claims: number;
    paid_fairly_claims: number;
    total_shortfall: number;
    ready_to_recover: number;
    estimated_fee: number;
    estimated_pharmacy_net: number;
  };
  claims: Array<{
    claim_id: string;
    fill_date: string;
    ndc: string;
    drug: string;
    pbm: string;
    state: string;
    total_paid: number;
    acquisition_cost: number;
    invoice_number: string | null;
    invoice_date: string | null;
    appeal_deadline: string;
    shortfall: number;
    status: ScanStatus;
    reason: string;
  }>;
};
