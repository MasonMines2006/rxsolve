import seed from "./claims.json";

export type SeedClaim = {
  claim_id: string;
  expect: string;
  meta: { pbm: string; pharmacy_id: string; state: string; plan: string; patient_ref: string };
  request: Record<string, string | number>;
};

const all = seed.claims as SeedClaim[];
/** The first six are expansion templates; the rest are fixed demo claims that occupy their own serials. */
const base = all.slice(0, 6);
const fixed = all.slice(6);
const fixedIds = new Set(fixed.map((c) => c.claim_id));
const underwaterTemplates = [base[0]!, base[1]!, base[2]!];
const clearTemplates: SeedClaim[] = [
  base[3]!,
  {
    ...base[1]!,
    meta: { ...base[1]!.meta, state: "NC", plan: "NC Commercial" },
    request: {
      ...base[1]!.request,
      "407-D7": "00378001801",
      "442-E7": 30,
      "405-D5": 30,
      "409-D9": 0.38,
      "426-DQ": 0.6,
    },
  },
  {
    ...base[2]!,
    meta: { ...base[2]!.meta, state: "NC", plan: "NC Commercial" },
    request: {
      ...base[2]!.request,
      "407-D7": "00781107210",
      "442-E7": 30,
      "405-D5": 30,
      "409-D9": 9,
      "426-DQ": 12,
    },
  },
];

function generated(template: SeedClaim, serial: number, expected: string, state = "NC"): SeedClaim {
  const claimId = `RXS-${String(serial).padStart(4, "0")}`;
  return {
    ...template,
    claim_id: claimId,
    expect: expected,
    meta: {
      ...template.meta,
      state,
      plan: state === "TN" ? "TN Part D" : "NC Commercial",
      patient_ref: `PT-S${String(serial).padStart(4, "0")}`,
    },
    request: { ...template.request, "402-D2": String(1_048_212 + serial) },
  };
}

const generatedClaims: SeedClaim[] = [];
for (let serial = 7; serial <= 20; serial++) {
  if (fixedIds.has(`RXS-${String(serial).padStart(4, "0")}`)) continue;
  generatedClaims.push(generated(underwaterTemplates[(serial - 7) % underwaterTemplates.length]!, serial, "SETTLED (underwater)"));
}

let serial = 21;
for (const [template, count] of [[clearTemplates[0]!, 12], [clearTemplates[1]!, 13], [clearTemplates[2]!, 13]] as const) {
  for (let i = 0; i < count; i++) generatedClaims.push(generated(template, serial++, "CLEARED"));
}
for (; serial <= 60; serial++) {
  const template = base[4]!;
  generatedClaims.push(generated(template, serial, "EXCEPTION (marginal)"));
}

/** Deterministic demo load: 18 underwater, 39 clear, 3 marginal across the three PBM personas. */
export const seedClaims: SeedClaim[] = [...base, ...fixed, ...generatedClaims];
