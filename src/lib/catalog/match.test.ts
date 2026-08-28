import { describe, expect, it } from "vitest";
import type { IgdbSearchHit } from "@/lib/igdb";
import fixtures from "./__fixtures__/search.json";
import { decide, findCandidates, scoreName, type SearchFn } from "./match";

/**
 * Regression tests for the known matching traps, against IGDB responses
 * recorded by scripts/record-igdb-fixtures.ts (platform 18 = NES).
 */
const recorded = fixtures as Record<string, IgdbSearchHit[]>;
const search: SearchFn = async (term, platformIds) => {
  const key = `${term}|${(platformIds ?? []).join(",")}`;
  if (!(key in recorded)) throw new Error(`no fixture for ${key} — rerun scripts/record-igdb-fixtures.ts`);
  return recorded[key];
};

async function best(title: string) {
  const cands = await findCandidates(title, [18], search);
  return { cands, verdict: decide(cands), top: cands[0] };
}

describe("matching traps", () => {
  it("Super Mario Bros → Super Mario Bros., never the Two Players Hack", async () => {
    const { top, verdict, cands } = await best("Super Mario Bros");
    expect(top.name).toBe("Super Mario Bros.");
    expect(verdict.kind).toBe("auto");
    expect(cands.map((c) => c.name)).not.toContain("Super Mario Bros.: Two Players Hack");
  });

  it("Gauntlet → Gauntlet, not Gauntlet II", async () => {
    const { top, verdict } = await best("Gauntlet");
    expect(top.name).toBe("Gauntlet");
    expect(verdict.kind).toBe("auto");
  });

  it("Duck Tales → Disney's DuckTales", async () => {
    const { top, verdict } = await best("Duck Tales");
    expect(top.name).toBe("Disney's DuckTales");
    expect(verdict.kind).toBe("auto");
  });

  it("Star Tropics → StarTropics", async () => {
    const { top, verdict } = await best("Star Tropics");
    expect(top.name).toBe("StarTropics");
    expect(verdict.kind).toBe("auto");
  });

  it("Duck Tales 2 → Disney's DuckTales 2 (sequel kept apart from the original)", async () => {
    const { top, verdict } = await best("Duck Tales 2");
    expect(top.name).toBe("Disney's DuckTales 2");
    expect(verdict.kind).toBe("auto");
  });

  it("Star Tropics II: Zoda's Revenge → Zoda's Revenge: StarTropics II (subtitle reordered)", async () => {
    const { top } = await best("Star Tropics II: Zoda's Revenge");
    expect(top.name).toBe("Zoda's Revenge: StarTropics II");
    expect(top.confidence).toBeGreaterThanOrEqual(0.9);
  });

  it("Legend of Zelda, The → The Legend of Zelda", async () => {
    const { top, verdict } = await best("Legend of Zelda, The");
    expect(top.name).toBe("The Legend of Zelda");
    expect(verdict.kind).toBe("auto");
  });

  it("Contra → the NES Contra, with Super C and Contra Force clearly behind", async () => {
    const { top, verdict } = await best("Contra");
    expect(top.name).toBe("Contra");
    expect(verdict.kind).toBe("auto");
  });

  it("Roller Games → Rollergames via the space-collapsed variant", async () => {
    const { top, verdict } = await best("Roller Games");
    expect(top.name.toLowerCase()).toBe("rollergames");
    expect(verdict.kind).toBe("auto");
  });

  it("an off-platform hit is capped below auto-accept", async () => {
    const offPlatform: SearchFn = async (term, platformIds) =>
      platformIds ? [] : [{ id: 1, name: term, platforms: [{ id: 19, name: "SNES" }] }];
    const cands = await findCandidates("Super Metroid", [18], offPlatform);
    expect(cands[0].onPlatform).toBe(false);
    expect(cands[0].confidence).toBe(0.8);
    expect(decide(cands).kind).toBe("low-confidence");
  });

  it("Pac-Man [Tengen] scores the bracket-stripped title", async () => {
    const { cands } = await best("Pac-Man [Tengen]");
    const pac = cands.find((c) => c.name === "Pac-Man");
    expect(pac).toBeDefined();
    expect(pac!.reason).toContain("exact");
  });
});

describe("scoreName", () => {
  const s = (q: string, c: string) => scoreName(q, c).score;
  it("ranks relationships in the intended order", () => {
    expect(s("Gauntlet", "Gauntlet")).toBe(1);
    expect(s("Ninja Gaiden III Ancient Ship of Doom", "Ninja Gaiden III: The Ancient Ship of Doom")).toBe(0.95);
    expect(s("Super Mario Bros and Duck Hunt", "Super Mario Bros. / Duck Hunt")).toBe(1);
    expect(s("Duck Tales", "Disney's DuckTales")).toBe(0.9);
    expect(s("Skate or Die 2", "Skate or Die 2: The Search for Double Trouble")).toBe(0.88);
    expect(s("Contra", "Contra Force")).toBe(0.7);
    expect(s("Contra", "Super Contra")).toBe(0.7);
    expect(s("Double Dragon", "Battletoads / Double Dragon")).toBe(0.7);
    expect(s("Gauntlet", "Gauntlet II")).toBe(0.45);
    expect(s("Paperboy", "Paperboy 2")).toBe(0.45);
    expect(s("Mega Man 2", "Mega Man 2: 30th Anniversary Classic Cartridge")).toBe(0.88);
  });
  it("does not mistake a sequel subtitle for a brand prefix", () => {
    expect(s("Renegade", "Target: Renegade")).toBeLessThan(0.9);
  });
});

describe("decide", () => {
  it("is not ambiguous when the runner-up is the same game's parent", async () => {
    const { verdict } = await best("Contra");
    expect(verdict.kind).toBe("auto");
  });
});
