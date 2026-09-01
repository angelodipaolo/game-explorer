import { describe, expect, it } from "vitest";
import { preciseWhenSchema } from "@/lib/dates";
import { endOf, outOfOrder, parsePrecise, samePeriod, startOf, storedPrecision } from "./precision";

/** Local midnight, the way every bare date in this app is read. */
const local = (y: number, m: number, d = 1, h = 0) => new Date(y, m - 1, d, h);

describe("parsePrecise", () => {
  it("reads a bare YYYY-MM as the first instant of that month, at month precision", () => {
    const { at, precision } = parsePrecise("2026-08");
    expect(precision).toBe("month");
    expect([at.getFullYear(), at.getMonth(), at.getDate()]).toEqual([2026, 7, 1]);
    expect([at.getHours(), at.getMinutes(), at.getSeconds()]).toEqual([0, 0, 0]);
    // Local, not UTC. `new Date("2026-08-01")` is UTC midnight, which is July
    // everywhere west of Greenwich — the whole reason parseWhen exists.
    expect(at.getMonth()).toBe(7);
  });

  it("still reads a bare YYYY-MM-DD as local midnight at day precision", () => {
    const { at, precision } = parsePrecise("2026-08-12");
    expect(precision).toBe("day");
    expect([at.getFullYear(), at.getMonth(), at.getDate()]).toEqual([2026, 7, 12]);
  });

  it("passes a full timestamp and a Date through as a day", () => {
    expect(parsePrecise("2026-08-30T12:34:56.000Z").at.toISOString()).toBe("2026-08-30T12:34:56.000Z");
    expect(parsePrecise("2026-08-30T12:34:56.000Z").precision).toBe("day");
    const d = new Date("2026-01-01T00:00:00.000Z");
    expect(parsePrecise(d)).toEqual({ at: d, precision: "day" });
  });

  it("normalises a month across a DST boundary without shifting the month", () => {
    // March is where a US timezone springs forward. The first instant of the
    // month must still be 1 March, not 29 February or 2 March, whichever side
    // of the transition the machine running this is on.
    const { at } = parsePrecise("2026-03");
    expect([at.getFullYear(), at.getMonth(), at.getDate()]).toEqual([2026, 2, 1]);
    expect(at.getHours()).toBe(0);
  });
});

describe("preciseWhenSchema", () => {
  it("accepts the three shapes a run's date may arrive in", () => {
    for (const v of ["2026-08", "2026-08-12", "2026-08-30T21:15:00-07:00"]) {
      expect(preciseWhenSchema.safeParse(v).success, v).toBe(true);
    }
    expect(preciseWhenSchema.safeParse(new Date()).success).toBe(true);
  });

  it("refuses a month that is not a month", () => {
    // `2026-13` is the one that matters: the obvious /^\d{4}-\d{2}$/ accepts
    // it and `new Date(2026, 12, 1)` rolls silently into January 2027, so a
    // typo becomes a confident date five months away rather than a 400.
    for (const v of ["2026-13", "2026-00", "2026-1", "26-08", "2026", "August 2026", "2026-08-"]) {
      expect(preciseWhenSchema.safeParse(v).success, v).toBe(false);
    }
  });
});

describe("startOf / endOf", () => {
  it("bounds a day and a month", () => {
    expect(startOf(local(2026, 8, 12, 14), "day")).toEqual(local(2026, 8, 12));
    expect(endOf(local(2026, 8, 12, 14), "day")).toEqual(new Date(2026, 7, 12, 23, 59, 59, 999));
    expect(startOf(local(2026, 8, 12), "month")).toEqual(local(2026, 8, 1));
    expect(endOf(local(2026, 8, 12), "month")).toEqual(new Date(2026, 7, 31, 23, 59, 59, 999));
  });

  it("finds the last day of a short month and of a leap February", () => {
    expect(endOf(local(2026, 2, 1), "month").getDate()).toBe(28);
    expect(endOf(local(2024, 2, 1), "month").getDate()).toBe(29);
    expect(endOf(local(2026, 4, 1), "month").getDate()).toBe(30);
    expect(endOf(local(2026, 12, 1), "month")).toEqual(new Date(2026, 11, 31, 23, 59, 59, 999));
  });

  it("groups instants into periods", () => {
    expect(samePeriod(local(2026, 8, 1), local(2026, 8, 31), "month")).toBe(true);
    expect(samePeriod(local(2026, 8, 31), local(2026, 9, 1), "month")).toBe(false);
    expect(samePeriod(local(2026, 8, 12, 9), local(2026, 8, 12, 22), "day")).toBe(true);
  });
});

describe("outOfOrder", () => {
  it("accepts a day start finished inside a month that contains it", () => {
    // Started 12 Aug, finished "Aug 2026" — stored as 1 Aug, which the naive
    // comparison called a 400. The run ended somewhere in the rest of August.
    expect(outOfOrder(local(2026, 8, 12), "day", local(2026, 8, 1), "month")).toBe(false);
  });

  it("accepts a run finished the day it started, whatever time it started", () => {
    // The live bug this fix repairs: start at 14:00 (a full timestamp), finish
    // with today's bare date, which is local midnight. Today's check refuses
    // the commonest run there is.
    expect(outOfOrder(local(2026, 8, 12, 14), "day", local(2026, 8, 12), "day")).toBe(false);
  });

  it("still refuses an end period that finishes before the start begins", () => {
    expect(outOfOrder(local(2026, 8, 12), "day", local(2026, 7, 1), "month")).toBe(true);
    expect(outOfOrder(local(2026, 8, 12), "day", local(2026, 8, 11), "day")).toBe(true);
    expect(outOfOrder(local(2026, 8, 1), "month", local(2026, 7, 31), "day")).toBe(true);
  });
});

describe("storedPrecision", () => {
  it("reads the column back, and falls to day on anything it does not know", () => {
    expect(storedPrecision("month")).toBe("month");
    expect(storedPrecision("day")).toBe("day");
    // The column is a String — SQLite has no enums — so a row written by hand
    // or by an older build can hold anything. "day" renders the value that is
    // actually stored, which is never a lie, only sometimes more than was said.
    expect(storedPrecision("decade")).toBe("day");
    expect(storedPrecision("")).toBe("day");
  });
});
