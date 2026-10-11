/** Display helpers for the ledger panel. Balances themselves always come from the API. */
export type AccountInfo = { name: string; role: string };

export function accountInfo(key: string): AccountInfo {
  const upper = key.toUpperCase();
  if (upper.startsWith("PBM")) return { name: "PBM account", role: "pays the remittance" };
  if (upper.includes("PLATFORM") || upper.includes("RXSOLVE")) return { name: "Platform account", role: "contingency fee" };
  if (upper.startsWith("PH-") || upper.includes("PHARMACY")) return { name: "Pharmacy account", role: "receives the recovery" };
  return { name: key, role: "" };
}

/** Signed change in cents-safe dollars; null when either side is unknown. */
export function balanceChange(current: number | undefined, baseline: number | undefined): number | null {
  if (typeof current !== "number" || typeof baseline !== "number") return null;
  return Math.round((current - baseline) * 100) / 100;
}
