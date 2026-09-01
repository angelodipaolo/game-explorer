import { describe, expect, it } from "vitest";
import { runDates, runSince, runSinceShort } from "./format";

const local = (y: number, m: number, d = 1) => new Date(y, m - 1, d);

/**
 * A run as the formatter sees it. The defaults are the common case — a dated,
 * day-precision, closed run — so each test states only what it is about.
 */
const run = (over: Partial<Parameters<typeof runDates>[0]> = {}) => ({
  startedAt: local(2026, 8, 12),
  startedPrecision: "day",
  endedAt: local(2026, 9, 14),
  endedPrecision: "day",
  undated: false,
  ...over,
});

describe("runDates", () => {
  it("renders a day-precision range exactly as it always has", () => {
    expect(runDates(run())).toBe("12 Aug 2026 — 14 Sep 2026");
  });

  it("collapses a month-precision run that started and ended in one month", () => {
    // Not cosmetic. "Aug 2026 — Aug 2026" reads as a range whose two ends
    // happen to coincide; "Aug 2026" reads as the claim that was made, and a
    // run inside one month is the most common past run there is.
    const s = run({ startedAt: local(2026, 8), startedPrecision: "month", endedAt: local(2026, 8), endedPrecision: "month" });
    expect(runDates(s)).toBe("Aug 2026");
  });

  it("states one year once across months, and both across years", () => {
    expect(runDates(run({ startedAt: local(2026, 8), startedPrecision: "month", endedAt: local(2026, 10), endedPrecision: "month" }))).toBe("Aug — Oct 2026");
    expect(runDates(run({ startedAt: local(2025, 11), startedPrecision: "month", endedAt: local(2026, 2), endedPrecision: "month" }))).toBe("Nov 2025 — Feb 2026");
    // Dec → Jan is the boundary that a "same year" shortcut gets wrong.
    expect(runDates(run({ startedAt: local(2025, 12), startedPrecision: "month", endedAt: local(2026, 1), endedPrecision: "month" }))).toBe("Dec 2025 — Jan 2026");
  });

  it("renders each end at its own precision when they disagree", () => {
    // The mixed case is not exotic: the Finished button stamps a full
    // timestamp onto whatever start the run was backdated with, so this is
    // what the app produces by default.
    expect(runDates(run({ endedAt: local(2026, 10), endedPrecision: "month" }))).toBe("12 Aug 2026 — Oct 2026");
    expect(runDates(run({ startedAt: local(2026, 8), startedPrecision: "month", endedAt: local(2026, 10, 3) }))).toBe("Aug 2026 — 3 Oct 2026");
    // …and a mixed pair inside one month is still a range, because the two
    // ends are two different claims.
    expect(runDates(run({ startedAt: local(2026, 8), startedPrecision: "month", endedAt: local(2026, 8, 30) }))).toBe("Aug 2026 — 30 Aug 2026");
  });

  it("ends an open run with 'now', at whatever precision it started", () => {
    expect(runDates(run({ endedAt: null }))).toBe("12 Aug 2026 — now");
    expect(runDates(run({ startedAt: local(2026, 8), startedPrecision: "month", endedAt: null }))).toBe("Aug 2026 — now");
  });

  it("never shows an undated run's placeholder timestamps", () => {
    // They are the afternoon the row was typed in, not when it was played.
    expect(runDates(run({ undated: true }))).toBe("Date unknown");
    expect(runDates(run({ undated: true, startedPrecision: "month" }))).toBe("Date unknown");
  });

  it("falls back to a day for a precision the app does not know", () => {
    expect(runDates(run({ startedPrecision: "fortnight" }))).toBe("12 Aug 2026 — 14 Sep 2026");
  });
});

describe("runSince", () => {
  it("reads only the start, at its own precision", () => {
    expect(runSince({ startedAt: local(2026, 8, 12), startedPrecision: "day" })).toBe("12 Aug 2026");
    expect(runSince({ startedAt: local(2026, 8), startedPrecision: "month" })).toBe("Aug 2026");
  });
});

describe("runSinceShort", () => {
  it("drops this year and keeps any other", () => {
    const thisYear = new Date().getFullYear();
    expect(runSinceShort({ startedAt: new Date(thisYear, 7, 12), startedPrecision: "day" })).toBe("12 Aug");
    expect(runSinceShort({ startedAt: new Date(thisYear, 7, 1), startedPrecision: "month" })).toBe("Aug");
    expect(runSinceShort({ startedAt: new Date(thisYear - 1, 7, 12), startedPrecision: "day" })).toBe(`12 Aug ${thisYear - 1}`);
    expect(runSinceShort({ startedAt: new Date(thisYear - 1, 7, 1), startedPrecision: "month" })).toBe(`Aug ${thisYear - 1}`);
  });
});
