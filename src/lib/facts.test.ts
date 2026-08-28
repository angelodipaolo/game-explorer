import { describe, expect, it } from "vitest";
import { playerSummary, resolvePlayerProfile, type CatalogPlayerData } from "./facts";

const base: CatalogPlayerData = {
  gameModes: [],
  mpOfflineMax: null,
  mpOfflineCoopMax: null,
  mpOfflineCoop: null,
  mpSplitscreen: null,
  mpCampaignCoop: null,
  ttbNormally: null,
};

describe("resolvePlayerProfile", () => {
  it("is all-unknown without catalog data", () => {
    const p = resolvePlayerProfile(null);
    expect(p.coop).toEqual({ value: null, source: null });
    expect(playerSummary(p)).toEqual({ label: "Players unknown", tier: "unknown" });
  });

  it("reads co-op yes/no from game_modes and records the tier", () => {
    const p = resolvePlayerProfile({ ...base, gameModes: [1, 2, 3] });
    expect(p.coop).toEqual({ value: true, source: "igdb:game_modes" });
    expect(p.maxPlayers.value).toBeNull();
    expect(playerSummary(p)).toEqual({ label: "Co-op", tier: "mode" });
  });

  it("reads exact counts from multiplayer_modes and derives simultaneous play", () => {
    const p = resolvePlayerProfile({ ...base, gameModes: [1, 2, 3], mpOfflineMax: 2, mpOfflineCoopMax: 2, mpOfflineCoop: true });
    expect(p.maxPlayers).toEqual({ value: 2, source: "igdb:multiplayer_modes" });
    expect(p.simultaneousPlay.value).toBe(true);
    expect(p.simultaneousPlay.source).toBe("derived");
    expect(playerSummary(p).label).toBe("1–2 players together");
  });

  it("does not guess simultaneous play from a bare Multiplayer tag", () => {
    const p = resolvePlayerProfile({ ...base, gameModes: [1, 2] });
    expect(p.multiplayer.value).toBe(true);
    expect(p.simultaneousPlay.value).toBeNull();
  });

  it("single-player-only derives 1 player, not simultaneous", () => {
    const p = resolvePlayerProfile({ ...base, gameModes: [1] });
    expect(p.maxPlayers).toMatchObject({ value: 1, source: "derived" });
    expect(p.simultaneousPlay.value).toBe(false);
    expect(playerSummary(p).label).toBe("1 player");
  });

  it("agent overrides beat catalog; manual beats agent", () => {
    const p = resolvePlayerProfile({ ...base, gameModes: [1, 2] }, [
      { field: "maxPlayers", value: "2", source: "agent", sourceUrl: "https://example.org" },
      { field: "simultaneousPlay", value: "false", source: "agent" },
      { field: "simultaneousPlay", value: "true", source: "manual" },
    ]);
    expect(p.maxPlayers).toMatchObject({ value: 2, source: "agent", sourceUrl: "https://example.org" });
    expect(p.simultaneousPlay).toMatchObject({ value: true, source: "manual" });
  });

  it("ignores overrides with the wrong type or an unknown field", () => {
    const p = resolvePlayerProfile({ ...base, gameModes: [1] }, [
      { field: "maxPlayers", value: '"two"', source: "agent" },
      { field: "bogus", value: "true", source: "agent" },
    ]);
    expect(p.maxPlayers.value).toBe(1);
  });
});
