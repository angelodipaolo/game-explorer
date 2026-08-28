import { describe, expect, it } from "vitest";
import { csvToRows, parseCsv } from "./csv";

describe("parseCsv", () => {
  it("handles quotes, embedded commas, CRLF and a BOM", () => {
    expect(parseCsv('﻿a,b\r\n"x, y","he said ""hi"""\n')).toEqual([
      ["a", "b"],
      ["x, y", 'he said "hi"'],
    ]);
  });
});

describe("csvToRows", () => {
  it("maps columns by header heuristics with no mapping step", () => {
    const { rows, columns, skipped } = csvToRows("Name,System,Qty,Notes\nContra,NES,2,loose\nDuck Tales,Nintendo,,\n,,,orphan note\n");
    expect(columns).toEqual({ title: 0, platform: 1, quantity: 2, notes: 3 });
    expect(rows).toEqual([
      { title: "Contra", platform: "NES", quantity: 2, completeness: null, condition: null, notes: "loose", igdbId: null },
      { title: "Duck Tales", platform: "Nintendo", quantity: 1, completeness: null, condition: null, notes: null, igdbId: null },
    ]);
    expect(skipped).toBe(1);
  });
  it("rejects a file with no recognisable title column", () => {
    expect(() => csvToRows("foo,bar\n1,2")).toThrow(/title column/);
  });
});
