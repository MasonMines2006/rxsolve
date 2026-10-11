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

// --- Review queue and policy setup -------------------------------------------------------------
// Everything below is a preview that runs in the browser. It never stores a claim or files an appeal.

export type ScanClaim = OpportunityScanResult["claims"][number];

/** The fields the policy preview needs. Kept small so tests do not have to build a full claim. */
type QueueClaim = Pick<ScanClaim, "claim_id" | "status" | "shortfall">;

/** Same default as the API's standing authorization in apps/api/src/policy.ts. */
export const DEFAULT_AUTO_FILE_MAX = 100;

const roundMoney = (value: number) => Math.round(value * 100) / 100;
const dollars = (value: number) => `$${value.toFixed(2)}`;
const sumShortfall = (claims: readonly QueueClaim[]) => roundMoney(claims.reduce((sum, claim) => sum + claim.shortfall, 0));

/** Claims a pharmacist can act on: ready ones plus small shortfalls that need a human look. */
export function reviewQueue<T extends { status: ScanStatus }>(claims: readonly T[]): T[] {
  return claims.filter((claim) => claim.status === "READY" || claim.status === "NEEDS_REVIEW");
}

/** Adds the claim if it is not selected, removes it if it is. Returns a new array. */
export function toggleSelected(selected: readonly string[], claimId: string): string[] {
  return selected.includes(claimId) ? selected.filter((id) => id !== claimId) : [...selected, claimId];
}

/** Reads the dollar-limit text box. Returns null for anything that is not a plain non-negative amount. */
export function parseAutoFileMax(raw: string): number | null {
  const text = raw.trim().replace(/^\$/, "");
  if (!/^\d+(\.\d{1,2})?$/.test(text)) return null;
  return Number(text);
}

export type PolicyPreview<T extends QueueClaim> = {
  autoFile: T[];
  needsApproval: Array<{ claim: T; why: string }>;
  autoFileTotal: number;
  needsApprovalTotal: number;
  selectedTotal: number;
};

/**
 * Splits the selected claims the way the standing authorization would: inside the policy they
 * would file on their own, outside it they would wait for the pharmacist.
 */
export function previewPolicy<T extends QueueClaim>(
  claims: readonly T[],
  selectedIds: readonly string[],
  autoFileMax: number,
): PolicyPreview<T> {
  const selected = reviewQueue(claims).filter((claim) => selectedIds.includes(claim.claim_id));
  const autoFile: T[] = [];
  const needsApproval: Array<{ claim: T; why: string }> = [];

  for (const claim of selected) {
    if (claim.status === "NEEDS_REVIEW") {
      needsApproval.push({ claim, why: "Small shortfall needs pharmacist review" });
    } else if (claim.shortfall > autoFileMax) {
      needsApproval.push({ claim, why: `${dollars(claim.shortfall)} is over the ${dollars(autoFileMax)} auto-file limit` });
    } else {
      autoFile.push(claim);
    }
  }

  return {
    autoFile,
    needsApproval,
    autoFileTotal: sumShortfall(autoFile),
    needsApprovalTotal: sumShortfall(needsApproval.map((entry) => entry.claim)),
    selectedTotal: sumShortfall(selected),
  };
}
