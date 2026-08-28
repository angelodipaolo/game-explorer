import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import type { IgdbApi, IgdbGame, IgdbSearchHit } from "@/lib/igdb";
import { syncCatalog, toCatalogRow } from "./sync";

const port: IgdbGame = {
  id: 100,
  name: "Contra",
  slug: "contra--1",
  game_type: 11,
  parent_game: 200,
  platforms: [{ id: 18, name: "Nintendo Entertainment System" }],
  game_modes: [1, 2, 3],
  multiplayer_modes: [{ id: 1, offlinecoop: true, offlinecoopmax: 2, offlinemax: 0 }],
  similar_games: [300, 301],
};
const parent: IgdbGame = {
  id: 200,
  name: "Contra",
  slug: "contra",
  summary: "Run and gun.",
  cover: { image_id: "cov200", width: 600, height: 800 },
  screenshots: [{ image_id: "ss1", width: 800, height: 700 }],
  genres: [{ id: 5, name: "Shooter" }],
  similar_games: [300, 302],
  platforms: [{ id: 52, name: "Arcade" }],
};
const stubs: IgdbSearchHit[] = [
  { id: 300, name: "Super C", slug: "super-c", cover: { image_id: "cov300" } },
  { id: 301, name: "Jackal", slug: "jackal" },
];

function fakeApi(): IgdbApi & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    async search() {
      calls.push("search");
      return [];
    },
    async games(ids) {
      calls.push(`games:${ids.join(",")}`);
      return [port, parent].filter((g) => ids.includes(g.id));
    },
    async stubs(ids) {
      calls.push(`stubs:${ids.join(",")}`);
      return stubs.filter((s) => ids.includes(s.id));
    },
    async timeToBeat(ids) {
      calls.push(`ttb:${ids.join(",")}`);
      return ids.includes(200) ? [{ game_id: 200, normally: 3600, hastily: 1800 }] : [];
    },
  };
}

describe("toCatalogRow", () => {
  it("treats absent and zero counts as unknown", () => {
    const row = toCatalogRow(port, null, null);
    expect(row.mpOfflineMax).toBeNull();
    expect(row.mpOfflineCoopMax).toBe(2);
    expect(row.mpOfflineCoop).toBe(true);
    expect(row.mpSplitscreen).toBeNull();
  });
  it("fills a port's gaps from its parent without overriding what it has", () => {
    const row = toCatalogRow(port, parent, { normally: 3600 });
    expect(row.summary).toBe("Run and gun.");
    expect(row.coverImageId).toBe("cov200");
    expect(JSON.parse(row.screenshots)).toHaveLength(1);
    expect(JSON.parse(row.genres)).toEqual(["Shooter"]);
    expect(JSON.parse(row.similarGameIds)).toEqual([300, 301]);
    expect(JSON.parse(row.platformIds)).toEqual([18]);
    expect(row.ttbNormally).toBe(60);
  });
});

describe("syncCatalog", () => {
  beforeEach(async () => {
    await prisma.catalogGame.deleteMany();
  });

  it("upserts full rows, fetches parents, and stubs similar games", async () => {
    const api = fakeApi();
    const report = await syncCatalog([100], api);
    expect(report.full).toBe(1);
    expect(report.stubs).toBe(2);
    expect(api.calls).toEqual(["games:100", "games:200", "ttb:100,200", "stubs:300,301"]);

    const contra = await prisma.catalogGame.findUniqueOrThrow({ where: { igdbId: 100 } });
    expect(contra.detail).toBe("full");
    expect(contra.summary).toBe("Run and gun.");
    expect(contra.ttbNormally).toBe(60);
    expect(contra.parentIgdbId).toBe(200);

    const stub = await prisma.catalogGame.findUniqueOrThrow({ where: { igdbId: 300 } });
    expect(stub.detail).toBe("stub");
    expect(stub.coverImageId).toBe("cov300");
  });

  it("never downgrades a full row to a stub and skips stubs that exist", async () => {
    const api = fakeApi();
    await prisma.catalogGame.create({ data: { igdbId: 300, name: "Super C (full)", slug: "super-c", detail: "full" } });
    await syncCatalog([100], api);
    const row = await prisma.catalogGame.findUniqueOrThrow({ where: { igdbId: 300 } });
    expect(row.detail).toBe("full");
    expect(row.name).toBe("Super C (full)");
    expect(api.calls.at(-1)).toBe("stubs:301");
  });
});
