import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import type { IgdbApi, IgdbCollection, IgdbGame } from "@/lib/igdb";
import { collectionsForGame, fetchCollection, proposeMembers } from "./collections";

/**
 * The seed path, offline. The fake API stands in for /v4/collections and
 * /v4/games — including the bit that matters most: a /games query carries the
 * `game_type` filter, so an id the rule excludes simply is not in the
 * response.
 */

const ts = (year: number) => Math.floor(Date.UTC(year, 0, 1) / 1000);

const GAMES: IgdbGame[] = [
  // 777 is a *similar* game, not a member: it must never be pulled in.
  { id: 100, name: "Mario Party", slug: "mario-party", first_release_date: ts(1998), cover: { image_id: "cov100" }, similar_games: [777] },
  { id: 101, name: "Mario Party (Wii U)", slug: "mario-party-wiiu", first_release_date: ts(2015), parent_game: 100 },
  { id: 102, name: "Mario Party 2", slug: "mario-party-2", first_release_date: ts(1999), cover: { image_id: "cov102" } },
  { id: 103, name: "Mario Party 3", slug: "mario-party-3", first_release_date: ts(2000) },
  // A port whose original is NOT in this collection stays an entry of its own.
  { id: 104, name: "Some Arcade Port", slug: "arcade-port", first_release_date: ts(1994), parent_game: 900 },
];
/** 999 is in the collection but is an e-Reader minigame the game_type rule drops. */
const COLLECTION: IgdbCollection = { id: 453, name: "Mario Party", slug: "mario-party", games: [100, 101, 102, 103, 104, 999] };

function fakeApi(over: Partial<IgdbApi> = {}): IgdbApi {
  return {
    async search() {
      return [];
    },
    async games(ids) {
      return GAMES.filter((g) => ids.includes(g.id));
    },
    async stubs(ids) {
      return [...GAMES, { id: 777, name: "Something Else Entirely", slug: "something-else" }].filter((g) => ids.includes(g.id));
    },
    async timeToBeat() {
      return [];
    },
    async collections(ids) {
      return [COLLECTION].filter((c) => ids.includes(c.id));
    },
    async collectionsByGame() {
      return [COLLECTION];
    },
    ...over,
  };
}

beforeEach(async () => {
  await prisma.seriesEntry.deleteMany();
  await prisma.series.deleteMany();
  await prisma.ownedGame.deleteMany();
  await prisma.catalogGame.deleteMany();
});

describe("fetchCollection", () => {
  it("hands back the whole member list, ids and all", async () => {
    const c = await fetchCollection(453, fakeApi());
    expect(c).toEqual({ id: 453, name: "Mario Party", slug: "mario-party", gameIds: [100, 101, 102, 103, 104, 999] });
    expect(await fetchCollection(1, fakeApi())).toBeNull();
  });
});

describe("proposeMembers", () => {
  it("hydrates, orders by release, collapses ports into their parent and reports what the game_type rule dropped", async () => {
    const seed = await proposeMembers(453, fakeApi());

    // 999 never came back from /games: the rule excluded it, and that is
    // reported rather than guessed at.
    expect(seed.skipped).toEqual([999]);
    expect(seed.candidates.map((c) => c.igdbId)).toEqual([104, 100, 102, 103]);
    expect(seed.candidates.map((c) => c.year)).toEqual([1994, 1998, 1999, 2000]);

    // The Wii U re-release folded into the 1998 original instead of taking a
    // place of its own in the list.
    const original = seed.candidates.find((c) => c.igdbId === 100)!;
    expect(original.variants.map((v) => v.igdbId)).toEqual([101]);
    expect(original.cover).toBe("cov100");
    // A port whose parent is outside the collection keeps its own row.
    expect(seed.candidates.find((c) => c.igdbId === 104)!.variants).toEqual([]);

    // Every candidate is a real catalog row now, so an entry the owner keeps
    // renders with a name and cover whether or not they own it.
    expect(await prisma.catalogGame.count()).toBe(5);
    // …and only those: seeding does not spray the similar games of every
    // member into the catalog on each preview and each check.
    expect(await prisma.catalogGame.findUnique({ where: { igdbId: 777 } })).toBeNull();
  });

  it("keeps a two-level chain in one group, under the root of the chain", async () => {
    // A → B → C, all three in the collection: a remake of the original and a
    // remaster of the remake. Keying on the immediate parent would split them.
    const chain: IgdbGame[] = [
      { id: 200, name: "Root", slug: "root", first_release_date: ts(1990) },
      { id: 201, name: "Remake", slug: "remake", first_release_date: ts(1995), parent_game: 200 },
      { id: 202, name: "Remaster of the remake", slug: "remaster", first_release_date: ts(2005), parent_game: 201 },
    ];
    const api = fakeApi({
      async collections(ids) {
        return ids.includes(7) ? [{ id: 7, name: "Chain", slug: "chain", games: [201, 202, 200] }] : [];
      },
      async games(ids) {
        return chain.filter((g) => ids.includes(g.id));
      },
    });
    const seed = await proposeMembers(7, api);
    expect(seed.candidates.map((c) => c.igdbId)).toEqual([200]);
    expect(seed.candidates[0].variants.map((v) => v.igdbId)).toEqual([201, 202]);
  });

  it("marks what is already on the shelf, including through a port", async () => {
    await proposeMembers(453, fakeApi());
    // The shelf holds the Wii U re-release, which collapsed into id 100.
    const owned = await prisma.ownedGame.create({ data: { title: "Mario Party", normalizedTitle: "mario party", platform: "wiiu", catalogGameId: 101 } });
    const seed = await proposeMembers(453, fakeApi());
    expect(seed.candidates.find((c) => c.igdbId === 100)!.ownedId).toBe(owned.id);
    expect(seed.candidates.find((c) => c.igdbId === 102)!.ownedId).toBeNull();
    expect(seed.candidates.filter((c) => c.ownedId).length).toBe(1);
  });

  it("is empty, not an error, for a collection IGDB lists no games in", async () => {
    const api = fakeApi({ async collections() { return [{ id: 7, name: "Empty", games: [] }]; } });
    const seed = await proposeMembers(7, api);
    expect(seed.candidates).toEqual([]);
    expect(seed.skipped).toEqual([]);
  });
});

describe("collectionsForGame", () => {
  it("uses the ids cached on the catalog row when they are there", async () => {
    await prisma.catalogGame.create({ data: { igdbId: 100, name: "Mario Party", slug: "mp", detail: "full", collections: "[453]" } });
    let reverseLookups = 0;
    const api = fakeApi({
      async collectionsByGame() {
        reverseLookups++;
        return [COLLECTION];
      },
    });
    expect((await collectionsForGame(100, api)).map((c) => c.id)).toEqual([453]);
    expect(reverseLookups).toBe(0);
  });

  it("falls back to IGDB's reverse lookup for a game that has not been synced since", async () => {
    expect((await collectionsForGame(100, fakeApi())).map((c) => c.name)).toEqual(["Mario Party"]);
  });
});
