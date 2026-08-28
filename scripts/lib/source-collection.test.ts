import { describe, expect, it } from "vitest";
import { collapseTitles, splitPlatformSuffix, type SourceRow } from "./source-collection";

const row = (over: Partial<SourceRow>): SourceRow => ({ id: Math.random().toString(36).slice(2), itemType: "game", title: "X", platform: null, completeness: null, conditionGrade: null, quantity: 1, notes: null, catalogSource: null, catalogGameId: null, ...over });

describe("collapseTitles", () => {
  it("collapses duplicates by normalized title, counts copies, drops junk and non-games", () => {
    const { games, dropped } = collapseTitles([
      row({ title: "Super Mario Bros" }),
      row({ title: "Super Mario Bros.", completeness: "cib" }),
      row({ title: "super mario bros" }),
      row({ title: "Import Test A" }),
      row({ title: "Top Loading Nintendo  Console" }),
      row({ title: "PlayStation 2 Slim", itemType: "console" }),
      row({ title: "Metal Gear Solid", platform: "PlayStation" }),
    ]);
    expect(games.map((g) => [g.title, g.copies, g.completeness])).toEqual([
      ["Super Mario Bros", 3, "cib"],
      ["Metal Gear Solid", 1, null],
    ]);
    expect(dropped).toHaveLength(3);
  });
});

describe("splitPlatformSuffix", () => {
  it("peels a trailing platform name off a title", () => {
    expect(splitPlatformSuffix("Joe and Mac Super Nintendo")).toEqual({ title: "Joe and Mac", platform: "Super Nintendo" });
    expect(splitPlatformSuffix("Contra")).toEqual({ title: "Contra", platform: null });
    expect(splitPlatformSuffix("Nintendo World Cup")).toEqual({ title: "Nintendo World Cup", platform: null });
  });
});
