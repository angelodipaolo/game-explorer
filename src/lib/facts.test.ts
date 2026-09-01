import { describe, expect, it } from "vitest";
import { resolvePlayerProfile, type CatalogPlayerData } from "./facts";

const base: CatalogPlayerData = {
  gameModes: [],
  mpOfflineMax: null,
  mpOfflineCoopMax: null,
  mpOfflineCoop: null,
  mpSplitscreen: null,
  mpCampaignCoop: null,
  mpOnlineCoop: null,
  mpOnlineMax: null,
  ttbNormally: null,
};

describe("resolvePlayerProfile", () => {
  it("is all-unknown without catalog data", () => {
    const p = resolvePlayerProfile(null);
    expect(p.coop).toEqual({ value: null, source: null });
    expect(p.onlineCoop).toEqual({ value: null, source: null });
  });

  it("reads co-op yes/no from game_modes and records the tier", () => {
    const p = resolvePlayerProfile({ ...base, gameModes: [1, 2, 3] });
    expect(p.coop).toEqual({ value: true, source: "igdb:game_modes" });
    expect(p.maxPlayers.value).toBeNull();
  });

  it("reads exact counts from multiplayer_modes and derives simultaneous play", () => {
    const p = resolvePlayerProfile({ ...base, gameModes: [1, 2, 3], mpOfflineMax: 2, mpOfflineCoopMax: 2, mpOfflineCoop: true });
    expect(p.maxPlayers).toEqual({ value: 2, source: "igdb:multiplayer_modes" });
    expect(p.simultaneousPlay.value).toBe(true);
    expect(p.simultaneousPlay.source).toBe("derived");
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

  it("takes both co-op kinds from multiplayer_modes, and keeps them apart", () => {
    const p = resolvePlayerProfile({ ...base, gameModes: [1, 2, 3], mpOfflineCoop: false, mpSplitscreen: false, mpOnlineCoop: true, mpOnlineMax: 4 });
    expect(p.localCoop).toMatchObject({ value: false, source: "igdb:multiplayer_modes" });
    expect(p.onlineCoop).toMatchObject({ value: true, source: "igdb:multiplayer_modes" });
    // The umbrella stays true: it IS co-op, we now also know which kind.
    expect(p.coop.value).toBe(true);
  });

  it("never lets the game_modes co-op tag claim a kind", () => {
    const p = resolvePlayerProfile({ ...base, gameModes: [1, 2, 3] });
    expect(p.coop).toEqual({ value: true, source: "igdb:game_modes" });
    expect(p.localCoop.value).toBeNull();
    expect(p.onlineCoop.value).toBeNull();
  });

  it("reads offline co-op, its max, and split screen on a co-op game as a couch", () => {
    expect(resolvePlayerProfile({ ...base, gameModes: [1, 2, 3], mpOfflineCoop: true }).localCoop).toMatchObject({ value: true, source: "igdb:multiplayer_modes" });
    expect(resolvePlayerProfile({ ...base, gameModes: [1, 2, 3], mpOfflineCoopMax: 4 }).localCoop).toMatchObject({ value: true, source: "igdb:multiplayer_modes" });
    expect(resolvePlayerProfile({ ...base, gameModes: [1, 3, 4] }).localCoop).toMatchObject({ value: true, source: "derived" });
    // Split screen on its own can be versus, so it says nothing about co-op.
    expect(resolvePlayerProfile({ ...base, gameModes: [1, 4] }).localCoop.value).toBeNull();
  });

  it("falls back to the online ceiling only when there is no offline one", () => {
    expect(resolvePlayerProfile({ ...base, mpOfflineMax: 2, mpOnlineMax: 8 }).maxPlayers.value).toBe(2);
    expect(resolvePlayerProfile({ ...base, mpOnlineMax: 8 }).maxPlayers).toMatchObject({ value: 8, source: "igdb:multiplayer_modes" });
  });

  it("takes a co-op kind from an agent fact, with its citation", () => {
    const p = resolvePlayerProfile({ ...base, gameModes: [1, 2] }, [{ field: "onlineCoop", value: "true", source: "agent", sourceUrl: "https://example.org/online" }]);
    expect(p.onlineCoop).toMatchObject({ value: true, source: "agent", sourceUrl: "https://example.org/online" });
  });

  it("ignores overrides with the wrong type or an unknown field", () => {
    const p = resolvePlayerProfile({ ...base, gameModes: [1] }, [
      { field: "maxPlayers", value: '"two"', source: "agent" },
      { field: "bogus", value: "true", source: "agent" },
    ]);
    expect(p.maxPlayers.value).toBe(1);
  });
});
