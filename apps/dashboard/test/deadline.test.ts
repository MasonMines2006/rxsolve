import { expect, test } from "bun:test";
import { deadlineLabel } from "../lib/deadline";

test("counts down to the end of the appeal deadline in UTC", () => {
  const now = Date.parse("2026-10-10T12:00:00Z");
  expect(deadlineLabel("2026-10-12", now)).toBe("Due in 2d 11h · 2026-10-12");
});

test("shows hours and minutes when a deadline is today", () => {
  const now = Date.parse("2026-10-10T20:00:00Z");
  expect(deadlineLabel("2026-10-10", now)).toBe("Due in 3h 59m · 2026-10-10");
});

test("reports overdue, missing, and malformed deadlines explicitly", () => {
  const now = Date.parse("2026-10-10T00:00:00Z");
  expect(deadlineLabel("2026-10-09", now)).toBe("Overdue · 2026-10-09");
  expect(deadlineLabel(null, now)).toBe("No deadline set");
  expect(deadlineLabel("not-a-date", now)).toBe("Deadline unavailable");
});
