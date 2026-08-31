import { describe, expect, it } from "vitest";
import { parseWhen } from "./dates";

describe("parseWhen", () => {
  it("reads a bare YYYY-MM-DD as local midnight, not UTC midnight", () => {
    const d = parseWhen("2026-08-30");
    // The calendar day you typed is the calendar day you get, in the timezone
    // you are standing in. `new Date("2026-08-30")` would be UTC midnight,
    // which is 29 August anywhere west of Greenwich.
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(7);
    expect(d.getDate()).toBe(30);
    expect([d.getHours(), d.getMinutes(), d.getSeconds()]).toEqual([0, 0, 0]);
  });

  it("differs from naive UTC parsing wherever the offset is not zero", () => {
    const local = parseWhen("2026-08-30");
    const naive = new Date("2026-08-30");
    if (local.getTimezoneOffset() === 0) expect(local.getTime()).toBe(naive.getTime());
    else expect(local.getTime()).not.toBe(naive.getTime());
    // Either way the local calendar day is right, which is the point.
    expect(local.getDate()).toBe(30);
  });

  it("leaves a full timestamp and a Date alone", () => {
    expect(parseWhen("2026-08-30T12:34:56.000Z").toISOString()).toBe("2026-08-30T12:34:56.000Z");
    const d = new Date("2026-01-01T00:00:00.000Z");
    expect(parseWhen(d)).toBe(d);
  });
});
