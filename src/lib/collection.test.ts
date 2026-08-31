import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { groupShelf, loadPlaying, platformCounts, type ShelfGame } from "./collection";
import { platformLabel } from "./platforms";

function row(title: string, platform: string, igdbId: number | null, ownedId = `${title}-${platform}`): ShelfGame {
  return {
    id: ownedId, title, name: title, platform, platformLabel: platform.toUpperCase(),
    copies: [{ ownedId, platform, platformLabel: platform.toUpperCase(), quantity: 1 }], quantity: 1,
    igdbId, cover: null, year: null, genres: [], themes: [], perspectives: [], rating: null, playtime: null,
    players: { label: "", tier: "unknown", max: null, coop: null, multiplayer: null, single: null, simultaneous: null, verified: false },
    hasScreenshots: false, tags: [], similar: [], summary: null, play: { status: "never", runs: 0, lastPlayedAt: null },
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
  /**
   * The documented rollup: the grouped card answers "am I in the middle of
   * this game", and you are, on whichever machine.
   */
  it("rolls play state up across copies: any open run wins, runs add up, last played is the latest", () => {
    const snes = { ...row("Chrono Trigger", "snes", 200, "ct-snes"), play: { status: "played" as const, runs: 2, lastPlayedAt: new Date("2019-05-01") } };
    const ds = { ...row("Chrono Trigger", "ds", 200, "ct-ds"), play: { status: "playing" as const, runs: 1, lastPlayedAt: new Date("2026-08-01") } };
    const [g] = groupShelf([snes, ds]);
    expect(g.play).toEqual({ status: "playing", runs: 3, lastPlayedAt: new Date("2026-08-01") });

    // No open run anywhere: one finished copy makes the whole entry "played".
    const [h] = groupShelf([snes, { ...row("Chrono Trigger", "ds", 200, "ct-ds"), play: { status: "never" as const, runs: 0, lastPlayedAt: null } }]);
    expect(h.play).toEqual({ status: "played", runs: 2, lastPlayedAt: new Date("2019-05-01") });

    // Untouched on every platform stays never.
    const [i] = groupShelf([row("Ico", "ps2", 300, "a"), row("Ico", "ps3", 300, "b")]);
    expect(i.play).toEqual({ status: "never", runs: 0, lastPlayedAt: null });
  });

  it("adds up copies on the same platform", () => {
    const out = groupShelf([row("Halo 3", "x360", 5, "a"), row("Halo 3", "x360", 5, "b")]);
    expect(out[0].copies).toEqual([{ ownedId: "a", platform: "x360", platformLabel: "X360", quantity: 2 }]);
  });
});

/**
 * The main menu is on every page and the shelf is on one, so the drawer's
 * counts come from the database while the shelf's come from a loaded
 * collection — two paths that have to agree or the menu lies about the shelf
 * it links to. This pins the two rules that make them agree.
 */
describe("platformCounts", () => {
  beforeEach(async () => {
    await prisma.ownedGame.deleteMany();
    await prisma.catalogGame.deleteMany();
  });

  it("counts copies per platform and grouped entries in total, the way groupShelf does", async () => {
    await prisma.catalogGame.createMany({
      data: [
        { igdbId: 100, name: "Stray", slug: "stray" },
        { igdbId: 200, name: "Contra", slug: "contra" },
      ],
    });
    const own = (title: string, platform: string, catalogGameId: number | null) =>
      prisma.ownedGame.create({ data: { title, normalizedTitle: title.toLowerCase(), platform, catalogGameId } });
    await own("Stray", "ps4", 100);
    await own("Stray", "ps5", 100);
    await own("Contra", "nes", 200);
    // Two shelf rows for the same catalog game on the same system — the shape
    // a re-titled cartridge takes, since (normalizedTitle, platform) is unique.
    // groupShelf merges them into one copy, so the menu must not count two.
    await own("Contra (USA)", "nes", 200);
    // Unlinked pair — grouped by title, exactly as the shelf groups them.
    await own("Roller Games", "nes", null);
    await own("Roller Games", "snes", null);

    const { platforms, total } = await platformCounts();
    expect(total).toBe(3);
    expect(platforms).toEqual([
      { slug: "nes", label: platformLabel("nes"), count: 2 },
      { slug: "ps4", label: platformLabel("ps4"), count: 1 },
      { slug: "ps5", label: platformLabel("ps5"), count: 1 },
      { slug: "snes", label: platformLabel("snes"), count: 1 },
    ]);
  });

  it("has nothing to list on an empty shelf", async () => {
    await expect(platformCounts()).resolves.toEqual({ platforms: [], total: 0 });
  });
});

/**
 * `/playing` filters with the shelf's own machinery (GAMEEXPLOR-0015), which
 * means every row on that page has to arrive carrying a real `ShelfGame` —
 * with its tags, its platform and its derived play state. Two things this
 * pins that are easy to lose: the rows are per **owned copy** and are never
 * grouped (you play a specific cartridge, and the queue is keyed by
 * `ownedGameId`), and the play state is merged in the way `loadShelf` merges
 * it, so a filter for `play=playing` on this page is not a contradiction.
 */
describe("loadPlaying", () => {
  beforeEach(async () => {
    await prisma.queueEntry.deleteMany();
    await prisma.playSession.deleteMany();
    await prisma.ownedGame.deleteMany();
    await prisma.catalogGame.deleteMany();
  });

  it("carries a per-copy ShelfGame, ungrouped, with play state merged in", async () => {
    await prisma.catalogGame.create({ data: { igdbId: 300, name: "Contra", slug: "contra", genres: JSON.stringify(["Shooter"]) } });
    const own = (title: string, platform: string, catalogGameId: number | null) =>
      prisma.ownedGame.create({ data: { title, normalizedTitle: title.toLowerCase(), platform, catalogGameId } });
    // The same catalog game on two systems: groupShelf would collapse these
    // into one entry and take one of the queue's keys with it.
    const nes = await own("Contra", "nes", 300);
    const snes = await own("Contra", "snes", 300);
    const zelda = await own("Zelda", "nes", null);
    await prisma.playSession.create({ data: { ownedGameId: nes.id, startedAt: new Date("2026-08-20T12:00:00.000Z") } });
    await prisma.queueEntry.create({ data: { ownedGameId: snes.id, position: 0 } });
    await prisma.queueEntry.create({ data: { ownedGameId: zelda.id, position: 1 } });

    const { inProgress, upNext } = await loadPlaying();
    expect(inProgress.map((r) => r.ownedGameId)).toEqual([nes.id]);
    expect(inProgress[0].game.id).toBe(nes.id);
    expect(inProgress[0].game.platform).toBe("nes");
    // Derived from the open session, exactly as loadShelf derives it — the
    // `play` filter reads this and would otherwise see every row as `never`.
    expect(inProgress[0].game.play.status).toBe("playing");
    expect(inProgress[0].game.tags.map((t) => t.tag)).toEqual(["Shooter"]);

    // The queue keeps its curated order and both copies stay distinct.
    expect(upNext.map((r) => r.ownedGameId)).toEqual([snes.id, zelda.id]);
    expect(upNext[0].game.copies.map((c) => c.platform)).toEqual(["snes"]);
    expect(upNext[0].game.play.status).toBe("never");
    expect(upNext[1].game.tags).toEqual([]);
  });

  it("does no work at all when both lists are empty", async () => {
    await expect(loadPlaying()).resolves.toEqual({ inProgress: [], upNext: [] });
  });
});
