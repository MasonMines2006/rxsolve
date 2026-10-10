/** Deadline clock (DESIGN.md section 9). Owner: P1. Dates are YYYY-MM-DD strings. */
import { statute } from "./reference";

export function businessAdd(start: string, days: number): string {
  const d = new Date(`${start}T00:00:00Z`);
  while (days > 0) {
    d.setUTCDate(d.getUTCDate() + 1);
    const wd = d.getUTCDay();
    if (wd !== 0 && wd !== 6) days--;
  }
  return d.toISOString().slice(0, 10);
}

export const deadlineFor = (state: string, fillDate: string) =>
  businessAdd(fillDate, statute(state).window_business_days);
