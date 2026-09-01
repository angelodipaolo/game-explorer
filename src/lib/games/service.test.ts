import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { normalizeTitle } from "@/lib/catalog/normalize";
import { prisma } from "@/lib/db";

/**
 * The four blob stores read their directory from the environment at import
 * time, so they are pointed at scratch directories before the module under
 * test is loaded — the same dance `src/lib/manuals/service.test.ts` does. It
 * matters more here than there: the assertion this file exists to protect is
 * that deleting a game unlinks four kinds of file, and a test that wrote into
 * the real `data/` would be checking the wrong disk.
 */
const root = path.join(os.tmpdir(), `games-test-${process.pid}`);
process.env.MAPS_DIR = path.join(root, "maps");
process.env.MANUALS_DIR = path.join(root, "manuals");
process.env.JOURNAL_DIR = path.join(root, "journal");
process.env.MUSIC_DIR = path.join(root, "music");

const { DEFAULT_LIMIT, deleteGame, gameById, listGames, listGamesSchema, parseListQuery, searchTokens, titleSearchClause, updateGame } = await import("./service");
const { writeImage: writeMapImage } = await import("@/lib/maps/image");
const { manualImages } = await import("@/lib/manuals/image");
const { journalImages } = await import("@/lib/journal/image");
const { musicFiles } = await import("@/lib/music/audio");

/** Bytes to store. The stores are handed the format directly, so nothing here has to be a real picture. */
const pixels = Buffer.alloc(64, 7);
const info = { format: "png", width: 1, height: 1 } as const;

const status = async (fn: () => Promise<unknown>) => {
  try {
    await fn();
    return 0;
  } catch (e) {
    return (e as { status: number }).status;
  }
};

const message = async (fn: () => Promise<unknown>) => {
  try {
    await fn();
    return "";
  } catch (e) {
    return (e as Error).message;
  }
};

/** The query the route hands the service, spelled the short way for the tests. */
const list = (q: Record<string, unknown> = {}) => listGames(listGamesSchema.parse(q));
const names = async (q: Record<string, unknown> = {}) => (await list(q)).games.map((g) => g.name);

const own = (title: string, platform: string, extra: { igdbId?: number; quantity?: number } = {}) =>
  prisma.ownedGame.create({
    data: { title, normalizedTitle: normalizeTitle(title), platform, quantity: extra.quantity ?? 1, catalogGameId: extra.igdbId ?? null },
  });

const catalog = (igdbId: number, name: string, opts: { cover?: string; year?: number } = {}) =>
  prisma.catalogGame.create({
    data: {
      igdbId,
      name,
      slug: `${igdbId}`,
      detail: "full",
      coverImageId: opts.cover ?? null,
      firstReleaseDate: opts.year ? new Date(Date.UTC(opts.year, 5, 1)) : null,
    },
  });

const dirs = () => [process.env.MAPS_DIR!, process.env.MANUALS_DIR!, process.env.JOURNAL_DIR!, process.env.MUSIC_DIR!];

beforeAll(async () => {
  for (const dir of dirs()) await fs.mkdir(dir, { recursive: true });
});
afterAll(async () => {
  await fs.rm(root, { recursive: true, force: true });
});
beforeEach(async () => {
  await prisma.playSession.deleteMany();
  await prisma.ownedGame.deleteMany();
  await prisma.catalogGame.deleteMany();
});

describe("searchTokens", () => {
  it("lower-cases and drops punctuation, because normalizeTitle already has", () => {
    expect(searchTokens("Sonic")).toEqual(["sonic"]);
    expect(searchTokens("SONIC")).toEqual(["sonic"]);
    expect(searchTokens("  Sonic:  the Hedgehog!  ")).toEqual(["sonic", "the", "hedgehog"]);
  });

  it("splits a single space-free word where letters meet digits", () => {
    expect(searchTokens("sonic2")).toEqual(["sonic", "2"]);
    expect(searchTokens("Sonic 2")).toEqual(["sonic", "2"]);
    // Already spaced: the caller has said where the boundaries are, so nothing further is invented.
    expect(searchTokens("mega man x4")).toEqual(["mega", "man", "x4"]);
  });

  it("leaves a one-letter prefix whole, because `t` matches nearly every title", () => {
    expect(searchTokens("t2")).toEqual(["t2"]);
    expect(searchTokens("x4")).toEqual(["x4"]);
    // The rule is about the split, not about short tokens generally: a bare
    // `2` typed as its own word is still one of the two tokens that matter.
    expect(searchTokens("sonic 2")).toEqual(["sonic", "2"]);
  });

  it("lists the shelf for a blank query and refuses one it cannot match at all", () => {
    expect(searchTokens("")).toEqual([]);
    expect(searchTokens("  --  ")).toEqual([]);
    // Absent, or blank: no title filter.
    expect(titleSearchClause("")).toBeNull();
    expect(titleSearchClause("   ")).toBeNull();
    expect(titleSearchClause(undefined)).toBeNull();
    // Typed, and unmatchable: a 400, never "here is everything".
    for (const q of ["---", "星のカービィ", "!!!"]) {
      expect(() => titleSearchClause(q), q).toThrow(/no characters this search can match/);
    }
  });

  it("requires every token, so word order and the words in between do not matter", () => {
    expect(titleSearchClause("sonic 2")).toEqual({ AND: [{ normalizedTitle: { contains: "sonic" } }, { normalizedTitle: { contains: "2" } }] });
  });
});

describe("listGames", () => {
  beforeEach(async () => {
    await catalog(1, "Sonic the Hedgehog", { cover: "co1", year: 1991 });
    await catalog(2, "Sonic the Hedgehog 2", { cover: "co2", year: 1992 });
    await own("Sonic the Hedgehog", "genesis", { igdbId: 1 });
    await own("Sonic the Hedgehog 2", "genesis", { igdbId: 2, quantity: 2 });
    await own("Sonic the Hedgehog 2", "sms", { igdbId: 2 });
    await own("Super Mario Bros.", "nes");
    await own("Duck Tales", "nes");
  });

  it("matches case-insensitively, tolerates punctuation, and finds a sequel from its number", async () => {
    for (const q of ["sonic", "SONIC", "  Sonic!  "]) {
      expect(await names({ q })).toEqual(["Sonic the Hedgehog", "Sonic the Hedgehog 2", "Sonic the Hedgehog 2"]);
    }
    // The case the ticket was opened for: three spellings, one answer.
    for (const q of ["sonic 2", "Sonic 2", "sonic2"]) {
      expect(await names({ q })).toEqual(["Sonic the Hedgehog 2", "Sonic the Hedgehog 2"]);
    }
    expect(await names({ q: "zelda" })).toEqual([]);
  });

  it("finds a compact shelf spelling from a spaced query", async () => {
    await own("DuckTales 2", "nes");
    expect(await names({ q: "duck tales" })).toEqual(["Duck Tales", "DuckTales 2"]);
  });

  it("carries a usable igdbId, cover and year, and nothing else", async () => {
    const [first] = (await list({ q: "sonic 2" })).games;
    expect(first).toEqual({
      ownedGameId: expect.any(String),
      igdbId: 2,
      name: "Sonic the Hedgehog 2",
      platform: "genesis",
      platformLabel: "Genesis",
      quantity: 2,
      coverImageId: "co2",
      firstReleaseYear: 1992,
    });
  });

  it("falls back to the shelf title when nothing links the copy to the catalog", async () => {
    const [mario] = (await list({ q: "mario" })).games;
    expect(mario).toMatchObject({ name: "Super Mario Bros.", igdbId: null, coverImageId: null, firstReleaseYear: null });
  });

  it("filters by platform, repeatably and through the alias table", async () => {
    expect(await names({ platform: ["nes"] })).toEqual(["Duck Tales", "Super Mario Bros."]);
    expect(await names({ platform: ["nes", "sms"] })).toEqual(["Duck Tales", "Sonic the Hedgehog 2", "Super Mario Bros."]);
    expect(await names({ platform: ["Master System"] })).toEqual(["Sonic the Hedgehog 2"]);
    // Combined with `q` it narrows; it never widens.
    expect(await names({ q: "sonic", platform: ["sms"] })).toEqual(["Sonic the Hedgehog 2"]);
  });

  it("refuses a console it has never heard of rather than answering with an empty shelf", async () => {
    expect(await status(() => list({ platform: ["jaguar"] }))).toBe(400);
  });

  it("never answers an unmatchable query with the whole collection", async () => {
    // The failure this guards: `---` normalizes to nothing, and a "no tokens
    // means no filter" shortcut would hand back every game on the shelf with a
    // 200 — one call away from DELETE.
    for (const q of ["---", "星のカービィ"]) {
      expect(await status(() => list({ q })), q).toBe(400);
    }
    // A query that is merely fruitless is still a fruitless search, not an error.
    expect(await names({ q: "t2" })).toEqual([]);
    // And a blank one still lists the shelf.
    expect(await names({ q: "  " })).toHaveLength(5);
  });

  it("walks the whole shelf one row at a time with no repeats and no gaps", async () => {
    const seen: string[] = [];
    let cursor: string | null = null;
    for (let i = 0; i < 20; i++) {
      const page = await list({ limit: 1, ...(cursor ? { cursor } : {}) });
      expect(page.games).toHaveLength(1);
      seen.push(page.games[0].ownedGameId);
      cursor = page.nextCursor;
      if (!cursor) break;
    }
    const all = (await prisma.ownedGame.findMany({ select: { id: true } })).map((o) => o.id);
    expect(cursor).toBeNull();
    expect(new Set(seen).size).toBe(seen.length);
    expect([...seen].sort()).toEqual([...all].sort());
  });

  it("pages a filtered set the same way, and does not hide one copy of a title behind the other", async () => {
    const first = await list({ q: "sonic 2", limit: 1 });
    expect(first.nextCursor).not.toBeNull();
    const second = await list({ q: "sonic 2", limit: 1, cursor: first.nextCursor! });
    expect(second.nextCursor).toBeNull();
    expect(first.games[0].ownedGameId).not.toBe(second.games[0].ownedGameId);
    expect([first.games[0].platform, second.games[0].platform].sort()).toEqual(["genesis", "sms"]);
  });

  it("refuses a cursor it did not issue", async () => {
    expect(await status(() => list({ cursor: "not-a-cursor" }))).toBe(400);
  });
});

describe("parseListQuery", () => {
  it("reads a repeated platform, and treats an empty parameter as one nobody set", () => {
    expect(parseListQuery(new URLSearchParams("q=sonic&platform=nes&platform=snes&limit=5"))).toEqual({ q: "sonic", platform: ["nes", "snes"], limit: 5, cursor: undefined });
    // `?limit=` is a shell that templated an unset variable. It means the default.
    expect(parseListQuery(new URLSearchParams("q=&platform=&limit=&cursor="))).toEqual({ q: undefined, platform: undefined, limit: DEFAULT_LIMIT, cursor: undefined });
    expect(parseListQuery(new URLSearchParams(""))).toEqual({ q: undefined, platform: undefined, limit: DEFAULT_LIMIT, cursor: undefined });
  });
});

describe("gameById", () => {
  it("counts what is already hanging off the copy", async () => {
    const g = await own("Contra", "nes");
    await prisma.gameCode.createMany({
      data: [
        { ownedGameId: g.id, kind: "cheat", effect: "30 lives", codeKey: "30LIVES" },
        { ownedGameId: g.id, kind: "game-genie", effect: "infinite lives", codeKey: "SZGA" },
      ],
    });
    await prisma.gameMap.create({ data: { ownedGameId: g.id, slug: "jungle", title: "Jungle" } });
    await prisma.gameTag.create({ data: { ownedGameId: g.id, key: "run-and-gun", tag: "Run and gun", source: "manual" } });
    await prisma.musicTrack.create({ data: { ownedGameId: g.id, title: "Jungle theme" } });

    expect((await gameById(g.id))!.counts).toEqual({ codes: 2, maps: 1, bookmarks: 0, manuals: 0, tags: 1, music: 1 });
    expect(await gameById("nope")).toBeNull();
  });
});

describe("updateGame", () => {
  /** The catalog sync a re-link runs, stubbed: no unit test here reaches IGDB. */
  const syncing = (available: number[]) => async (igdbId: number) => {
    if (!available.includes(igdbId)) return { fetched: [] }; // what the game_type filter does: the id is simply not in the answer
    await catalog(igdbId, `IGDB ${igdbId}`, { cover: `co${igdbId}` });
    return { fetched: [igdbId] };
  };

  it("corrects the platform and the quantity", async () => {
    const g = await own("Joe and Mac", "nes");
    expect(await updateGame(g.id, { platform: "Super Nintendo", quantity: 2 }, syncing([]))).toMatchObject({ platform: "snes", platformLabel: "SNES", quantity: 2 });
  });

  it("refuses to move a copy onto a platform where the same title already sits", async () => {
    await own("Contra", "nes");
    const snes = await own("Contra", "snes");
    expect(await status(() => updateGame(snes.id, { platform: "nes" }, syncing([])))).toBe(409);
  });

  it("re-links through the catalog sync, so the catalog row exists afterwards", async () => {
    const g = await own("Contra", "nes");
    expect(await updateGame(g.id, { igdbId: 1234 }, syncing([1234]))).toMatchObject({ igdbId: 1234, name: "IGDB 1234", coverImageId: "co1234" });
    expect(await prisma.catalogGame.findUnique({ where: { igdbId: 1234 } })).not.toBeNull();
    const row = (await prisma.ownedGame.findUnique({ where: { id: g.id } }))!;
    expect(row.matchSource).toBe("manual");
    expect(row.matchConfidence).toBeNull();
  });

  it("leaves the old link alone when IGDB has no game of a type this app catalogs", async () => {
    await catalog(1, "Contra");
    const g = await own("Contra", "nes", { igdbId: 1 });
    expect(await status(() => updateGame(g.id, { igdbId: 999 }, syncing([])))).toBe(422);
    expect((await prisma.ownedGame.findUnique({ where: { id: g.id } }))!.catalogGameId).toBe(1);
  });

  it("leaves the old link alone when IGDB cannot be reached", async () => {
    await catalog(1, "Contra");
    const g = await own("Contra", "nes", { igdbId: 1 });
    const unreachable = async () => {
      throw new Error("fetch failed");
    };
    expect(await status(() => updateGame(g.id, { igdbId: 999 }, unreachable))).toBe(502);
    expect((await prisma.ownedGame.findUnique({ where: { id: g.id } }))!.catalogGameId).toBe(1);
  });

  it("unlinks on an explicit null, and never touches IGDB to do it", async () => {
    await catalog(1, "Contra");
    const g = await own("Contra", "nes", { igdbId: 1 });
    const patched = await updateGame(g.id, { igdbId: null }, async () => {
      throw new Error("unlinking must not call IGDB");
    });
    expect(patched.igdbId).toBeNull();
    expect((await prisma.ownedGame.findUnique({ where: { id: g.id } }))!.matchSource).toBeNull();
  });

  it("404s on an id that is not on the shelf", async () => {
    expect(await status(() => updateGame("nope", { quantity: 2 }, syncing([])))).toBe(404);
  });
});

describe("deleteGame", () => {
  it("refuses while a run is open, and names the game and the run in the message", async () => {
    const g = await own("Chrono Trigger", "snes");
    await prisma.playSession.create({ data: { ownedGameId: g.id, startedAt: new Date("2026-08-01T12:00:00Z") } });

    expect(await status(() => deleteGame(g.id))).toBe(409);
    // The date reads the way the rest of the app spells it, not as an ISO
    // slice: `toISOString()` printed a UTC day, so a run stored at local
    // midnight came back as the day before for anyone west of Greenwich.
    expect(await message(() => deleteGame(g.id))).toMatch(/Chrono Trigger.*run in progress \(started 1 Aug 2026\)/);
    expect(await prisma.ownedGame.findUnique({ where: { id: g.id } })).not.toBeNull();

    // A month-precision run must not have a day invented for it here either —
    // this message is the seventh place a run's date reaches a reader, and the
    // one where they cannot go and check the real value.
    await prisma.playSession.updateMany({ where: { ownedGameId: g.id }, data: { startedPrecision: "month" } });
    expect(await message(() => deleteGame(g.id))).toMatch(/run in progress \(started Aug 2026\)/);

    // A finished run is history, not an obstacle.
    await prisma.playSession.updateMany({ where: { ownedGameId: g.id }, data: { endedAt: new Date("2026-08-05T12:00:00Z"), outcome: "completed" } });
    await deleteGame(g.id);
    expect(await prisma.ownedGame.findUnique({ where: { id: g.id } })).toBeNull();
    expect(await prisma.playSession.count()).toBe(0);
  });

  it("takes the rows the schema cascades and the bytes it does not", async () => {
    const g = await own("Castlevania", "nes");
    const map = await prisma.gameMap.create({ data: { ownedGameId: g.id, slug: "castle", title: "Castle" } });
    const manual = await prisma.gameManual.create({ data: { ownedGameId: g.id } });
    const page = await prisma.manualPage.create({ data: { manualId: manual.id, position: 0 } });
    const photo = await prisma.journalEntry.create({ data: { ownedGameId: g.id, kind: "photo", occurredAt: new Date() } });
    await prisma.journalEntry.create({ data: { ownedGameId: g.id, kind: "note", body: "beat block 5", occurredAt: new Date() } });
    const track = await prisma.musicTrack.create({ data: { ownedGameId: g.id, title: "Vampire Killer" } });
    await prisma.gameCode.create({ data: { ownedGameId: g.id, kind: "cheat", effect: "stage select", codeKey: "STAGE" } });

    await writeMapImage(map.id, pixels, info);
    await manualImages.write(page.id, pixels, info);
    await journalImages.write(photo.id, pixels, info);
    await musicFiles.write(track.id, pixels, "mp3");
    expect(await prisma.journalEntry.count()).toBe(2);

    // Only the photo has bytes, so only the photo is counted — a note is a row.
    expect(await deleteGame(g.id)).toMatchObject({ title: "Castlevania", platform: "nes", files: { maps: 1, manualPages: 1, journalPhotos: 1, musicTracks: 1 } });

    // The rows, by cascade.
    expect(await prisma.gameMap.count()).toBe(0);
    expect(await prisma.manualPage.count()).toBe(0);
    expect(await prisma.journalEntry.count()).toBe(0);
    expect(await prisma.musicTrack.count()).toBe(0);
    expect(await prisma.gameCode.count()).toBe(0);
    // And the files, which a cascade would have left behind — the whole reason
    // this goes through a service rather than a deleteMany.
    for (const dir of dirs()) expect(await fs.readdir(dir), dir).toEqual([]);
  });

  it("404s on an id that is not on the shelf", async () => {
    expect(await status(() => deleteGame("nope"))).toBe(404);
  });
});
