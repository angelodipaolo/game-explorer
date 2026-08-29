import { describe, expect, it } from "vitest";
import { groupShelf, type ShelfGame } from "./collection";

function row(title: string, platform: string, igdbId: number | null, ownedId = `${title}-${platform}`): ShelfGame {
  return {
    id: ownedId, title, name: title, platform, platformLabel: platform.toUpperCase(),
    copies: [{ ownedId, platform, platformLabel: platform.toUpperCase(), quantity: 1 }], quantity: 1,
    igdbId, cover: null, year: null, genres: [], themes: [], perspectives: [], rating: null, playtime: null,
    players: { label: "", tier: "unknown", max: null, coop: null, multiplayer: null, single: null, simultaneous: null, verified: false },
    hasScreenshots: false, tags: [], similar: [], summary: null,
  };
}

describe("groupShelf", () => {
  it("collapses the same IGDB game across platforms into one entry, oldest platform first", () => {
    const out = groupShelf([row("Stray", "ps5", 100), row("Stray", "ps4", 100), row("Contra", "nes", 1)]);
    expect(out).toHaveLength(2);
    const stray = out.find((g) => g.name === "Stray")!;
    expect(stray.copies.map((c) => c.platform)).toEqual(["ps4", "ps5"]);
    expect(stray.platform).toBe("ps4");
    expect(stray.id).toBe("Stray-ps4");
    expect(stray.quantity).toBe(2);
  });
  it("keeps different games apart even with the same title, and groups unlinked ones by title", () => {
    const out = groupShelf([row("Tetris", "nes", 1), row("Tetris", "gb", 2), row("Roller Games", "nes", null), row("Roller Games", "snes", null)]);
    expect(out.map((g) => `${g.name}:${g.copies.length}`).sort()).toEqual(["Roller Games:2", "Tetris:1", "Tetris:1"]);
  });
  it("adds up copies on the same platform", () => {
    const out = groupShelf([row("Halo 3", "x360", 5, "a"), row("Halo 3", "x360", 5, "b")]);
    expect(out[0].copies).toEqual([{ ownedId: "a", platform: "x360", platformLabel: "X360", quantity: 2 }]);
  });
});
