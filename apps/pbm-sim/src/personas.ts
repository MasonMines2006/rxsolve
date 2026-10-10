import data from "../data/personas.json";
import mac from "../data/mac_list.json";

export type Persona = (typeof data.personas)["PBM_PORTAL"];
export const personas = data.personas as Record<string, Persona>;

export const persona = (pbm: string): Persona => {
  const p = personas[pbm];
  if (!p) throw new Error(`unknown PBM ${pbm}`);
  return p;
};
export const requiredFields = (pbm: string, state: string): string[] => [
  ...persona(pbm).required_fields,
  ...((data.state_rules as Record<string, unknown>)[state] as string[] | undefined ?? []),
];
export const macUnit = (pbm: string, ndc: string): number | undefined => (mac as unknown as Record<string, Record<string, number>>)[pbm]?.[ndc];
export const copay = (plan: string): number => (data.copay as Record<string, number>)[plan] ?? data.copay.default;
export const delayMs = (pbm: string) => persona(pbm).response_delay_s * 1000 * Number(process.env.PBM_SIM_DELAY_SCALE ?? 1);
