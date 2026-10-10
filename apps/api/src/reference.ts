/** Reference data loader. Owner: shared (per-file owners in fixtures/README.md). */
import specs from "./fixtures/specs.json";
import statutes from "./fixtures/statutes.json";
import invoices from "./fixtures/invoices.json";
import nadac from "./fixtures/nadac.json";
import contracts from "./fixtures/contracts.json";
import drugs from "./fixtures/drugs.json";
import type { Channel } from "@rxsolve/contracts";

export type Spec = { channel: Channel; version: string; modeled_on: string; required_fields: string[]; source_url: string };
export type Statute = { citation: string; entitlement: string; window_business_days: number; regulator: string; version: string };
export type InvoiceLine = (typeof invoices)[number];

export const spec = (pbm: string): Spec => (specs as Record<string, Spec>)[pbm]!;
export const statute = (state: string): Statute =>
  (statutes as Record<string, Statute>)[state] ?? statutes.default;
export const invoice = (ndc: string): InvoiceLine | undefined => invoices.find((l) => l.ndc === ndc);
export const nadacUnit = (ndc: string): number | undefined => (nadac as Record<string, number>)[ndc];
export const contractUnit = (plan: string, ndc: string): number | undefined =>
  (contracts as Record<string, number>)[`${plan}|${ndc}`];
export const drugName = (ndc: string): string => (drugs as Record<string, string>)[ndc] ?? ndc;
