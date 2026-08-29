import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { startRun } from "@/lib/enrichment/service";
import { addManualTag, listTags, removeTag, unhideTag, writeAgentTags } from "./service";

let id: string;
beforeEach(async () => {
  await prisma.gameTag.deleteMany();
  await prisma.enrichmentRun.deleteMany();
  await prisma.ownedGame.deleteMany();
  id = (await prisma.ownedGame.create({ data: { title: "Metroid", normalizedTitle: "metroid", platform: "nes" } })).id;
});

describe("tags service", () => {
  it("manual add/remove, hide/unhide IGDB, and counts", async () => {
    await addManualTag(id, " Metroidvania ");
    await removeTag(id, "Shooter", { igdb: true });
    expect((await prisma.gameTag.findMany({ where: { ownedGameId: id } })).map((t) => `${t.key}:${t.source}`).sort()).toEqual(["metroidvania:manual", "shooter:igdb-hide"]);
    expect(await listTags()).toEqual([{ key: "metroidvania", tag: "Metroidvania", count: 1, manual: 1, agent: 0 }]);
    await unhideTag(id, "Shooter");
    await removeTag(id, "metroidvania");
    expect(await prisma.gameTag.count()).toBe(0);
  });
  it("agent tags are cited, never override manual, and manual replaces agent", async () => {
    const run = await startRun("tags");
    await addManualTag(id, "Roguelike");
    const r = await writeAgentTags(run.id, [
      { ownedGameId: id, tag: "roguelike", sourceUrl: "https://x" },
      { ownedGameId: id, tag: "Metroidvania", sourceUrl: "https://x" },
      { ownedGameId: "nope", tag: "x", sourceUrl: "https://x" },
    ]);
    expect(r.written).toEqual([{ ownedGameId: id, tag: "Metroidvania" }]);
    expect(r.skipped.map((s) => s.reason)).toEqual(["already set by hand", "owned game not found"]);
    await addManualTag(id, "Metroidvania");
    expect((await prisma.gameTag.findMany({ where: { ownedGameId: id, key: "metroidvania" } })).map((t) => t.source)).toEqual(["manual"]);
  });
});
