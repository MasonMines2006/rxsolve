import { useEffect, useState } from "react";

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

export function useDeadlineClock(): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), MINUTE);
    return () => window.clearInterval(timer);
  }, []);

  return now;
}

export function deadlineLabel(deadline: string | null | undefined, now = Date.now()): string {
  if (!deadline) return "No deadline set";

  const deadlineAt = Date.parse(`${deadline}T23:59:59Z`);
  if (!Number.isFinite(deadlineAt)) return "Deadline unavailable";

  const remaining = deadlineAt - now;
  if (remaining <= 0) return `Overdue · ${deadline}`;

  const days = Math.floor(remaining / DAY);
  const hours = Math.floor((remaining % DAY) / (60 * MINUTE));
  const minutes = Math.max(1, Math.floor((remaining % (60 * MINUTE)) / MINUTE));
  const countdown = days > 0
    ? `Due in ${days}d ${hours}h`
    : hours > 0
      ? `Due in ${hours}h ${minutes}m`
      : `Due in ${minutes}m`;

  return `${countdown} · ${deadline}`;
}

const URGENT_WITHIN = 2 * DAY;

/** Compact countdown for dense rows, for example "2d 11h" or "Overdue". */
export function deadlineShort(deadline: string | null | undefined, now = Date.now()): string {
  const label = deadlineLabel(deadline, now);
  if (label.startsWith("Overdue")) return "Overdue";
  return label.split(" · ")[0]!.replace(/^Due in /, "");
}

/** True when a real deadline is past or less than two days away. */
export function deadlineUrgent(deadline: string | null | undefined, now = Date.now()): boolean {
  if (!deadline) return false;
  const at = Date.parse(`${deadline}T23:59:59Z`);
  return Number.isFinite(at) && at - now < URGENT_WITHIN;
}
