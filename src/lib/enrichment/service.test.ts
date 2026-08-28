import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { resolvePlayerProfile } from "@/lib/facts";
import { finishRun, listGaps, startRun, writeAgentFacts, writeManualFact } from "./service";

async function seed() {
  await prisma.gameFact.deleteMany();
  await prisma.enrichmentRun.deleteMany();
  await prisma.ownedGame.deleteMany();
  await prisma.catalogGame.deleteMany();
  await prisma.catalogGame.create({ data: { igdbId: 1, name: "Contra", slug: "contra", detail: "full", gameModes: "[1,2,3]", mpOfflineMax: 2, mpOfflineCoop: true } });
  await prisma.catalogGame.create({ data: { igdbId: 2, name: "Tecmo Bowl", slug: "tecmo", detail: "full", gameModes: "[1,2]" } });
  const contra = await prisma.ownedGame.create({ data: { title: "Contra", normalizedTitle: "contra", platform: "nes", catalogGameId: 1 } });
  const tecmo = await prisma.ownedGame.create({ data: { title: "Tecmo Bowl", normalizedTitle: "tecmo bowl", platform: "nes", catalogGameId: 2 } });
  const roller = await prisma.ownedGame.create({ data: { title: "Roller Games", normalizedTitle: "roller games", platform: "nes" } });
  return { contra, tecmo, roller };
}

describe("enrichment", () => {
  beforeEach(seed);

  it("lists only games with gaps, saying what is missing and what is known", async () => {
    const { gaps, total } = await listGaps(["maxPlayers", "simultaneousPlay"]);
    expect(total).toBe(2);
    const byTitle = Object.fromEntries(gaps.map((g) => [g.title, g]));
    expect(byTitle["Contra"]).toBeUndefined();
    expect(byTitle["Tecmo Bowl"].missing).toEqual(["maxPlayers", "simultaneousPlay"]);
    expect(byTitle["Tecmo Bowl"].known.multiplayer).toEqual({ value: true, source: "igdb:game_modes" });
    expect(byTitle["Roller Games"].missing).toEqual(["maxPlayers", "simultaneousPlay"]);
  });

  it("writes cited agent facts, refuses uncited ones, and reports", async () => {
    const { tecmo, roller } = await seed();
    const run = await startRun("test");
    const r = await writeAgentFacts(run.id, [
      { ownedGameId: tecmo.id, field: "maxPlayers", value: 2, sourceUrl: "https://example.org/tecmo" },
      { ownedGameId: tecmo.id, field: "simultaneousPlay", value: true, sourceUrl: "https://example.org/tecmo" },
      { ownedGameId: roller.id, field: "maxPlayers", value: 1 },
      { ownedGameId: "nope", field: "coop", value: false, sourceUrl: "https://example.org" },
    ]);
    expect(r.written).toHaveLength(2);
    expect(r.skipped.map((s) => s.reason)).toEqual([expect.stringContaining("sourceUrl"), "owned game not found"]);
    const report = await finishRun(run.id);
    expect(report).toMatchObject({ factsWritten: 2, gamesTouched: 1, byField: { maxPlayers: 1, simultaneousPlay: 1 } });
    expect(report.finishedAt).not.toBeNull();
    await expect(writeAgentFacts(run.id, [{ ownedGameId: tecmo.id, field: "coop", value: false, sourceUrl: "https://x.org" }])).rejects.toMatchObject({ status: 409 });

    const facts = await prisma.gameFact.findMany({ where: { ownedGameId: tecmo.id } });
    const profile = resolvePlayerProfile({ gameModes: [1, 2], mpOfflineMax: null, mpOfflineCoopMax: null, mpOfflineCoop: null, mpSplitscreen: null, mpCampaignCoop: null, ttbNormally: null }, facts);
    expect(profile.maxPlayers).toMatchObject({ value: 2, source: "agent", sourceUrl: "https://example.org/tecmo" });
    expect((await listGaps(["maxPlayers"])).gaps.map((g) => g.title)).toEqual(["Roller Games"]);
  });

  it("never lets an agent overwrite a manual fact, but manual overwrites agent", async () => {
    const { roller } = await seed();
    const run = await startRun();
    await writeAgentFacts(run.id, [{ ownedGameId: roller.id, field: "maxPlayers", value: 4, sourceUrl: "https://example.org" }]);
    await writeManualFact(roller.id, "maxPlayers", 2, "checked the manual");
    const r = await writeAgentFacts(run.id, [{ ownedGameId: roller.id, field: "maxPlayers", value: 4, sourceUrl: "https://example.org" }]);
    expect(r.written).toEqual([]);
    expect(r.skipped[0].reason).toContain("manual");
    const fact = await prisma.gameFact.findUniqueOrThrow({ where: { ownedGameId_field: { ownedGameId: roller.id, field: "maxPlayers" } } });
    expect(fact).toMatchObject({ source: "manual", value: "2", note: "checked the manual" });
    await writeManualFact(roller.id, "maxPlayers", null);
    expect(await prisma.gameFact.count({ where: { ownedGameId: roller.id } })).toBe(0);
  });

  it("rejects a manual value of the wrong type", async () => {
    const { roller } = await seed();
    await expect(writeManualFact(roller.id, "coop", 3)).rejects.toMatchObject({ status: 400 });
  });
});
