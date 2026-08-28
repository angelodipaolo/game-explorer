import { beforeEach, describe, expect, it } from "vitest";
import type { CatalogPort, MatchCandidate } from "@/lib/catalog";
import { prisma } from "@/lib/db";
import { ImportError, addRows, commitSession, createSession, decideRow, discardSession, getSession, rollbackBatch } from "./service";

function cand(igdbId: number, name: string, confidence: number, extra: Partial<MatchCandidate> = {}): MatchCandidate {
  return { igdbId, name, slug: name.toLowerCase(), confidence, gameType: 0, parentId: null, onPlatform: true, via: name, coverImageId: null, firstReleaseYear: 1990, platformNames: ["NES"], reason: "test", ...extra };
}

/** A catalog that knows a handful of NES games and never touches the network. */
function fakeCatalog(): CatalogPort & { synced: number[][] } {
  const table: Record<string, MatchCandidate[]> = {
    contra: [cand(1, "Contra", 1), cand(2, "Contra Force", 0.7)],
    gauntlet: [cand(3, "Gauntlet II", 0.45)],
    tetris: [cand(4, "Tetris", 1), cand(5, "Tetris", 1)],
    "duck tales": [cand(6, "Disney's DuckTales", 0.9)],
    "roller games": [],
  };
  const synced: number[][] = [];
  return {
    synced,
    async candidates(title) {
      return table[title.toLowerCase()] ?? [];
    },
    async sync(ids) {
      synced.push(ids);
      for (const id of ids) {
        await prisma.catalogGame.upsert({ where: { igdbId: id }, create: { igdbId: id, name: `Game ${id}`, slug: `game-${id}`, detail: "full" }, update: {} });
      }
      return { full: ids.length, stubs: 0, requests: 1 };
    },
  };
}

beforeEach(async () => {
  await prisma.importEffect.deleteMany();
  await prisma.importBatch.deleteMany();
  await prisma.importRow.deleteMany();
  await prisma.importSession.deleteMany();
  await prisma.ownedGame.deleteMany();
  await prisma.catalogGame.deleteMany();
});

describe("addRows", () => {
  it("auto-resolves confident matches and holds the rest with a reason", async () => {
    const catalog = fakeCatalog();
    const s = await createSession(
      {
        label: "t",
        source: "agent",
        defaultPlatform: "NES",
        rows: [{ title: "Contra", quantity: 1 }, { title: "Gauntlet", quantity: 1 }, { title: "Tetris", quantity: 1 }, { title: "Roller Games", quantity: 1 }, { title: "Zelda", platform: "Ouya", quantity: 1 }],
      },
      { catalog },
    );
    const by = Object.fromEntries(s.rows.map((r) => [r.title, r]));
    expect(by.Contra.decision).toBe("auto");
    expect(by.Contra.chosenIgdbId).toBe(1);
    expect(by.Contra.platform).toBe("nes");
    expect(by.Gauntlet).toMatchObject({ decision: "review", holdReason: "low-confidence" });
    expect(by.Tetris).toMatchObject({ decision: "review", holdReason: "ambiguous" });
    expect(by["Roller Games"]).toMatchObject({ decision: "review", holdReason: "no-match" });
    expect(by.Zelda).toMatchObject({ decision: "review", holdReason: "invalid" });
    expect(JSON.parse(by.Zelda.problems)).toEqual(['unknown platform "Ouya"']);
    expect(JSON.parse(by.Tetris.candidates)).toHaveLength(2);
  });

  it("trusts an agent-pinned igdbId", async () => {
    const s = await createSession({ label: "t", source: "agent", rows: [{ title: "Contra", platform: "nes", quantity: 1, igdbId: 99 }] }, { catalog: fakeCatalog() });
    expect(s.rows[0]).toMatchObject({ decision: "accepted", decidedBy: "agent", chosenIgdbId: 99 });
  });

  it("merges in-session duplicates into the first occurrence", async () => {
    const s = await createSession(
      { label: "t", source: "agent", defaultPlatform: "nes", rows: [{ title: "Contra", quantity: 1 }, { title: "contra", quantity: 2 }, { title: "Contra", platform: "Famicom", quantity: 1 }] },
      { catalog: fakeCatalog() },
    );
    expect(s.rows[0].decision).toBe("auto");
    expect(s.rows[1]).toMatchObject({ decision: "merge", dedupeKind: "in-session", dedupeTargetId: s.rows[0].id });
    expect(s.rows[2]).toMatchObject({ decision: "merge", dedupeKind: "in-session" });
  });

  it("holds collisions with the existing collection", async () => {
    await prisma.ownedGame.create({ data: { title: "Contra", normalizedTitle: "contra", platform: "nes", quantity: 1 } });
    const s = await createSession({ label: "t", source: "agent", defaultPlatform: "nes", rows: [{ title: "Contra", quantity: 1 }] }, { catalog: fakeCatalog() });
    expect(s.rows[0]).toMatchObject({ decision: "review", holdReason: "duplicate", dedupeKind: "existing" });
  });

  it("refuses rows on a closed session", async () => {
    const s = await createSession({ label: "t", source: "agent", rows: [] }, { catalog: fakeCatalog() });
    await discardSession(s.id);
    await expect(addRows(s.id, [{ title: "x", platform: "nes", quantity: 1 }], null, { catalog: fakeCatalog() })).rejects.toBeInstanceOf(ImportError);
  });
});

describe("decideRow", () => {
  it("lets a person pick a candidate, drop, or accept unlinked", async () => {
    const catalog = fakeCatalog();
    const s = await createSession({ label: "t", source: "agent", defaultPlatform: "nes", rows: [{ title: "Tetris", quantity: 1 }, { title: "Gauntlet", quantity: 1 }, { title: "Roller Games", quantity: 1 }] }, { catalog });
    const [tetris, gauntlet, roller] = s.rows;
    expect(await decideRow(s.id, tetris.id, { decision: "accepted", igdbId: 5, decidedBy: "user" })).toMatchObject({ decision: "accepted", chosenIgdbId: 5, chosenConfidence: 1, holdReason: null });
    expect(await decideRow(s.id, gauntlet.id, { decision: "dropped", decidedBy: "user" })).toMatchObject({ decision: "dropped" });
    expect(await decideRow(s.id, roller.id, { decision: "accepted", igdbId: null, decidedBy: "user" })).toMatchObject({ decision: "accepted", chosenIgdbId: null });
  });

  it("can rename a row to fix the title/platform", async () => {
    const s = await createSession({ label: "t", source: "agent", rows: [{ title: "Joe and Mac Super Nintendo", platform: "nes", quantity: 1 }] }, { catalog: fakeCatalog() });
    const row = await decideRow(s.id, s.rows[0].id, { decision: "accepted", igdbId: 42, title: "Joe & Mac", platform: "SNES", decidedBy: "user" });
    expect(row).toMatchObject({ title: "Joe & Mac", normalizedTitle: "joe and mac", platform: "snes", chosenIgdbId: 42 });
  });
});

describe("commitSession", () => {
  it("refuses to commit while rows are in review, listing them", async () => {
    const s = await createSession({ label: "t", source: "agent", defaultPlatform: "nes", rows: [{ title: "Contra", quantity: 1 }, { title: "Gauntlet", quantity: 1 }] }, { catalog: fakeCatalog() });
    await expect(commitSession(s.id, {}, { catalog: fakeCatalog() })).rejects.toMatchObject({ status: 409, details: { unresolved: [{ title: "Gauntlet", holdReason: "low-confidence" }] } });
    expect(await prisma.ownedGame.count()).toBe(0);
  });

  it("force-commits held rows unlinked, but never invalid ones", async () => {
    const s = await createSession({ label: "t", source: "agent", defaultPlatform: "nes", rows: [{ title: "Contra", quantity: 1 }, { title: "Roller Games", quantity: 1 }] }, { catalog: fakeCatalog() });
    const result = await commitSession(s.id, { force: true }, { catalog: fakeCatalog() });
    expect(result).toMatchObject({ created: 2, unlinked: 1, merged: 0, dropped: 0 });
    const roller = await prisma.ownedGame.findUniqueOrThrow({ where: { normalizedTitle_platform: { normalizedTitle: "roller games", platform: "nes" } } });
    expect(roller.catalogGameId).toBeNull();
    expect(roller.importBatchId).toBe(result.batchId);

    const bad = await createSession({ label: "t2", source: "agent", rows: [{ title: "X", platform: "Ouya", quantity: 1 }] }, { catalog: fakeCatalog() });
    await expect(commitSession(bad.id, { force: true }, { catalog: fakeCatalog() })).rejects.toMatchObject({ status: 409 });
  });

  it("writes one transaction with merges, in-session folds, and effects", async () => {
    const existing = await prisma.ownedGame.create({ data: { title: "Duck Tales", normalizedTitle: "duck tales", platform: "nes", quantity: 1 } });
    const catalog = fakeCatalog();
    const s = await createSession(
      { label: "t", source: "agent", defaultPlatform: "nes", rows: [{ title: "Contra", quantity: 1 }, { title: "Contra", quantity: 2 }, { title: "Duck Tales", quantity: 3 }, { title: "Gauntlet", quantity: 1 }] },
      { catalog },
    );
    await decideRow(s.id, s.rows[2].id, { decision: "merge", decidedBy: "user" });
    await decideRow(s.id, s.rows[3].id, { decision: "dropped", decidedBy: "user" });
    const result = await commitSession(s.id, {}, { catalog });
    expect(result).toMatchObject({ created: 1, merged: 1, dropped: 1, unlinked: 0 });
    expect(catalog.synced).toEqual([[1]]);

    const contra = await prisma.ownedGame.findUniqueOrThrow({ where: { normalizedTitle_platform: { normalizedTitle: "contra", platform: "nes" } } });
    expect(contra.quantity).toBe(3);
    expect(contra.catalogGameId).toBe(1);
    expect(contra.matchSource).toBe("auto");
    expect(contra.matchConfidence).toBe(1);
    expect((await prisma.ownedGame.findUniqueOrThrow({ where: { id: existing.id } })).quantity).toBe(4);

    const effects = await prisma.importEffect.findMany({ where: { batchId: result.batchId }, orderBy: { id: "asc" } });
    expect(effects.map((e) => e.kind).sort()).toEqual(["created", "quantity"]);
    expect((await getSession(s.id)).status).toBe("committed");
  });

  it("leaves nothing behind if the transaction fails", async () => {
    const catalog = fakeCatalog();
    const s = await createSession({ label: "t", source: "agent", defaultPlatform: "nes", rows: [{ title: "Contra", quantity: 1 }, { title: "Duck Tales", quantity: 1 }] }, { catalog });
    // Sabotage: make the second row collide with something created after staging, so the unique index throws mid-transaction.
    await prisma.ownedGame.create({ data: { title: "Duck Tales", normalizedTitle: "duck tales", platform: "nes", quantity: 1 } });
    await expect(commitSession(s.id, {}, { catalog })).rejects.toThrow();
    expect(await prisma.ownedGame.count()).toBe(1);
    expect(await prisma.importBatch.count()).toBe(0);
    expect((await getSession(s.id)).status).toBe("open");
  });
});

describe("rollbackBatch", () => {
  it("removes exactly what the batch wrote and nothing else", async () => {
    const before = await prisma.ownedGame.create({ data: { title: "Metroid", normalizedTitle: "metroid", platform: "nes", quantity: 1 } });
    const dup = await prisma.ownedGame.create({ data: { title: "Duck Tales", normalizedTitle: "duck tales", platform: "nes", quantity: 2 } });
    const catalog = fakeCatalog();
    const s = await createSession({ label: "t", source: "agent", defaultPlatform: "nes", rows: [{ title: "Contra", quantity: 1 }, { title: "Duck Tales", quantity: 5 }, { title: "Roller Games", quantity: 1 }] }, { catalog });
    await decideRow(s.id, s.rows[1].id, { decision: "merge", decidedBy: "user" });
    await decideRow(s.id, s.rows[2].id, { decision: "accepted", igdbId: null, decidedBy: "user" });
    const { batchId } = await commitSession(s.id, {}, { catalog });
    expect(await prisma.ownedGame.count()).toBe(4);

    // Something unrelated happens after the import.
    const after = await prisma.ownedGame.create({ data: { title: "Zelda", normalizedTitle: "zelda", platform: "nes", quantity: 1 } });

    const result = await rollbackBatch(batchId);
    expect(result).toEqual({ batchId, removed: 2, decremented: 1 });
    const remaining = await prisma.ownedGame.findMany({ orderBy: { title: "asc" } });
    expect(remaining.map((g) => g.id).sort()).toEqual([before.id, dup.id, after.id].sort());
    expect((await prisma.ownedGame.findUniqueOrThrow({ where: { id: dup.id } })).quantity).toBe(2);
    expect((await prisma.importBatch.findUniqueOrThrow({ where: { id: batchId } })).status).toBe("rolled_back");
    expect((await getSession(s.id)).status).toBe("open");
    await expect(rollbackBatch(batchId)).rejects.toMatchObject({ status: 409 });
  });
});
