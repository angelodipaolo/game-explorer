import { describe, expect, it } from "vitest";
import { resolvePlayerProfile, type CatalogPlayerData, type Override } from "./facts";
import { describePlayers, playersShort } from "./players";

const base: CatalogPlayerData = {
  gameModes: [],
  mpOfflineMax: null,
  mpOfflineCoopMax: null,
  mpOfflineCoop: null,
  mpSplitscreen: null,
  mpCampaignCoop: null,
  ttbNormally: null,
};

const describeOf = (c: Partial<CatalogPlayerData> | null, overrides: Override[] = []) => describePlayers(resolvePlayerProfile(c ? { ...base, ...c } : null, overrides));
const shortOf = (c: Partial<CatalogPlayerData> | null, overrides: Override[] = []) => describeOf(c, overrides).short;
const agent = (field: string, value: string): Override => ({ field, value, source: "agent", sourceUrl: "https://example.org" });

describe("the count axis", () => {
  it("renders a range with an en dash, not a hyphen", () => {
    const d = describeOf({ gameModes: [1, 2], mpOfflineMax: 4 });
    expect(d.count).toMatchObject({ min: 1, max: 4, label: "1–4" });
    expect(d.count.label).toContain("–");
    expect(d.count.label).not.toContain("-");
  });

  it("starts at 2 when single player is ruled out", () => {
    const d = describeOf({ gameModes: [2], mpOfflineMax: 4 });
    expect(d.count).toMatchObject({ min: 2, max: 4, label: "2–4" });
  });

  it("collapses a range of one to a single number", () => {
    expect(describeOf({ gameModes: [1], mpOfflineMax: 1 }).count.label).toBe("1");
    expect(describeOf({ gameModes: [2], mpOfflineMax: 2 }).count.label).toBe("2");
  });

  it("says nothing when the count is unknown", () => {
    const d = describeOf(null);
    expect(d.count).toMatchObject({ min: null, max: null, label: null, tier: "unknown" });
    expect(d.short).toBe("? players");
  });
});

describe("the co-op axis", () => {
  it("calls IGDB's co-op local, because every column it gives us is", () => {
    const d = describeOf({ gameModes: [1, 2, 3], mpOfflineMax: 2 });
    expect(d.coop).toMatchObject({ value: "local", label: "Local co-op" });
    expect(d.short).toBe("1–2 · Local co-op");
  });

  it("reads split screen as local co-op too", () => {
    expect(describeOf({ gameModes: [1, 4], mpOfflineMax: 2 }).coop.value).toBe("local");
  });

  it("only ever gets online co-op from a researched fact", () => {
    const igdb = describeOf({ gameModes: [1, 2], mpOfflineMax: 2, mpSplitscreen: false });
    expect(igdb.coop.value).toBeNull();
    const researched = describeOf({ gameModes: [1, 2], mpOfflineMax: 2 }, [agent("onlineCoop", "true")]);
    expect(researched.coop).toMatchObject({ value: "online", label: "Online co-op", verified: true });
  });

  it("names both kinds when a game has both", () => {
    const d = describeOf({ gameModes: [1, 2, 3], mpOfflineMax: 4 }, [agent("onlineCoop", "true")]);
    expect(d.coop).toMatchObject({ value: "both", label: "Local + online co-op" });
    expect(d.short).toBe("1–4 · Local + online co-op");
  });

  it("never says a bare Co-op", () => {
    for (const c of [{ gameModes: [1, 2, 3] }, { gameModes: [1, 4] }, { gameModes: [1, 2, 3], mpOfflineMax: 3 }]) {
      expect(describeOf(c).coop.label).not.toBe("Co-op");
    }
  });
});

describe("togetherness", () => {
  it("is Together when players play at once and Taking turns when they alternate", () => {
    expect(describeOf({ gameModes: [1, 2], mpOfflineMax: 2 }, [agent("simultaneousPlay", "true")]).together).toMatchObject({ value: "simultaneous", label: "Together" });
    expect(describeOf({ gameModes: [1, 2], mpOfflineMax: 2 }, [agent("simultaneousPlay", "false")]).together).toMatchObject({ value: "alternating", label: "Taking turns" });
  });

  it("Super Mario Kart plays together, Donkey Kong Country takes turns", () => {
    const kart = shortOf({ gameModes: [1, 2], mpOfflineMax: 2 }, [agent("simultaneousPlay", "true")]);
    const dkc = shortOf({ gameModes: [1, 2, 3], mpOfflineMax: 2 }, [agent("simultaneousPlay", "false")]);
    expect(kart).toBe("1–2 · Versus · Together");
    expect(dkc).toBe("1–2 · Local co-op · Taking turns");
  });

  it("says nothing at all on a one-player game", () => {
    const d = describeOf({ gameModes: [1] });
    expect(d.together).toMatchObject({ value: null, label: null });
    expect(d.short).toBe("1 player");
  });

  it("is unknown until someone finds out", () => {
    const d = describeOf({ gameModes: [1, 2], mpOfflineMax: 2 });
    expect(d.together.value).toBeNull();
    expect(d.short).toBe("1–2 · Versus");
  });
});

describe("versus", () => {
  it("is multiplayer that is known not to be co-op", () => {
    const d = describeOf({ gameModes: [1, 2], mpOfflineMax: 4, mpOfflineCoop: false, mpSplitscreen: false });
    expect(d.versus).toBe(true);
    expect(d.short).toBe("1–4 · Versus");
  });

  it("is not claimed for a one-player game, or where co-op is simply unknown", () => {
    expect(describeOf({ gameModes: [1] }).versus).toBe(false);
    // A count with no game_modes at all: more than one player, but nobody has
    // said whether they are on the same side.
    expect(describeOf({ mpOfflineMax: 4 }).versus).toBe(false);
  });
});

describe("the compact line", () => {
  it("says Multiplayer when there is more than one player and nothing finer", () => {
    // Only reachable from a researched multiplayer fact: IGDB's game_modes
    // always answers co-op too, and an exact count always gives a range.
    expect(shortOf(null, [agent("multiplayer", "true")])).toBe("Multiplayer");
  });

  it("keeps a lone range as a sentence and a qualified one as digits", () => {
    expect(shortOf({ gameModes: [1], mpOfflineMax: 1 })).toBe("1 player");
    expect(shortOf({ mpOfflineMax: 4 })).toBe("1–4 players");
    expect(shortOf({ gameModes: [1, 2, 3], mpOfflineMax: 4, mpOfflineCoop: true })).toBe("1–4 · Local co-op · Together");
  });

  it("drops the least important qualifier first when there is no room", () => {
    const d = describeOf({ gameModes: [1, 2, 3], mpOfflineMax: 4 });
    expect(playersShort(d, 1)).toBe("1–4 · Local co-op");
    expect(playersShort(d, 0)).toBe("1–4 players");
  });

  it("falls back to the co-op kind when there is no count", () => {
    expect(shortOf({ gameModes: [1, 2, 3] })).toBe("Local co-op");
  });
});

describe("confidence", () => {
  it("is exact for a counted game, mode for one IGDB only tagged, unknown for nothing", () => {
    expect(describeOf({ gameModes: [1, 2], mpOfflineMax: 2 }).tier).toBe("exact");
    expect(describeOf({ gameModes: [1, 2, 3] }).tier).toBe("mode");
    expect(describeOf(null).tier).toBe("unknown");
  });

  it("marks a hand-set or researched fact verified, and an inferred one inferred", () => {
    const researched = describeOf({ gameModes: [1, 2] }, [agent("maxPlayers", "2")]);
    expect(researched).toMatchObject({ verified: true, inferred: false });
    // simultaneousPlay is ours: derived here from IGDB's offline co-op flag.
    const inferred = describeOf({ gameModes: [1, 2, 3], mpOfflineMax: 2, mpOfflineCoop: true });
    expect(inferred).toMatchObject({ verified: false, inferred: true });
    expect(describeOf(null)).toMatchObject({ verified: false, inferred: false });
  });

  it("never renders unknown as a no", () => {
    const d = describeOf({ gameModes: [] });
    expect(d.short).toBe("? players");
    expect(d.coop).toMatchObject({ value: null, none: false });
    expect(d.versus).toBe(false);
  });
});
