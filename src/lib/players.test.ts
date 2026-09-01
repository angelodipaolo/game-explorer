import { describe, expect, it } from "vitest";
import { resolvePlayerProfile, type CatalogPlayerData, type Override } from "./facts";
import { describePlayers, playersLineLabel, playersShort, tierHint, MODE_LABELS } from "./players";

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

const describeOf = (c: Partial<CatalogPlayerData> | null, overrides: Override[] = []) => describePlayers(resolvePlayerProfile(c ? { ...base, ...c } : null, overrides));
const shortOf = (c: Partial<CatalogPlayerData> | null, overrides: Override[] = []) => describeOf(c, overrides).short;
const agent = (field: string, value: string): Override => ({ field, value, source: "agent", sourceUrl: "https://example.org" });
const byHand = (field: string, value: string): Override => ({ field, value, source: "manual" });

describe("the count axis", () => {
  it("renders a range with an en dash, not a hyphen", () => {
    const d = describeOf({ gameModes: [1, 2], mpOfflineMax: 4 });
    expect(d.count).toMatchObject({ min: 1, max: 4, label: "1–4" });
    expect(d.count.label).toContain("–");
    expect(d.count.label).not.toContain("-");
  });

  it("starts at 2 when single player is ruled out", () => {
    expect(describeOf({ gameModes: [2], mpOfflineMax: 4 }).count).toMatchObject({ min: 2, max: 4, label: "2–4" });
  });

  it("says 'up to' rather than claiming a floor nobody stated", () => {
    // An offline max of 4 with no game_modes says nothing about playing alone,
    // and "1–4" would be an unknown rendered as a yes.
    const d = describeOf({ mpOfflineMax: 4 });
    expect(d.count).toMatchObject({ min: null, max: 4, label: "Up to 4" });
    expect(d.short).toBe("Up to 4 players");
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

  it("falls back to the online ceiling when a game has no offline mode at all", () => {
    expect(describeOf({ gameModes: [1, 2], mpOnlineMax: 4 }).count).toMatchObject({ max: 4, label: "1–4", tier: "exact" });
  });
});

describe("the co-op axis", () => {
  it("says a bare Co-op when IGDB's tag is all we have — it is not a claim about a couch", () => {
    // game_modes id 3 is "Co-Operative". Bloodborne carries it.
    const d = describeOf({ gameModes: [1, 2, 3], mpOfflineMax: 2 });
    expect(d.coop).toMatchObject({ value: "coop", label: "Co-op", tier: "mode" });
    expect(d.short).toBe("1–2 · Co-op");
  });

  it("only calls it local when the evidence is about a couch", () => {
    expect(describeOf({ gameModes: [1, 2, 3], mpOfflineMax: 2, mpOfflineCoop: true }).coop).toMatchObject({ value: "local", label: "Local co-op", tier: "exact" });
    // offlinecoopmax is offline co-op stated as a number.
    expect(describeOf({ gameModes: [1, 2, 3], mpOfflineCoopMax: 4 }).coop).toMatchObject({ value: "local" });
    // split screen alone is not co-op — it can be versus — but split screen on
    // a cooperative game is a couch.
    expect(describeOf({ gameModes: [1, 4], mpOfflineMax: 2 }).coop.value).toBeNull();
    expect(describeOf({ gameModes: [1, 3, 4], mpOfflineMax: 2 }).coop).toMatchObject({ value: "local", tier: "mode" });
  });

  it("resolves Bloodborne's shape as online, not local", () => {
    const d = describeOf({ gameModes: [1, 2, 3], mpOfflineCoop: false, mpSplitscreen: false, mpOnlineCoop: true, mpOnlineMax: 4 });
    expect(d.coop).toMatchObject({ value: "online", label: "Online co-op", tier: "exact" });
    expect(d.short).toBe("1–4 · Online co-op · Together");
  });

  it("reads online co-op with the local kind genuinely unknown", () => {
    const d = describeOf({ mpOnlineCoop: true });
    expect(d.coop).toMatchObject({ value: "online", label: "Online co-op" });
    expect(d.short).toBe("Online co-op");
  });

  it("names both kinds when a game has both", () => {
    const d = describeOf({ gameModes: [1, 2, 3], mpOfflineMax: 4, mpOfflineCoop: true, mpOnlineCoop: true });
    expect(d.coop).toMatchObject({ value: "both", label: "Local + online co-op" });
    expect(d.short).toBe("1–4 · Local + online co-op · Together");
  });

  it("renders a hand-set co-op fact as the umbrella it was written as", () => {
    // Rows keyed `coop` predate the kinds and mean "players cooperate".
    // Reading them as a couch would invent data the owner never entered.
    const d = describeOf(null, [byHand("coop", "true")]);
    expect(d.coop).toMatchObject({ value: "coop", label: "Co-op", tier: "exact", verified: true });
  });

  it("lets a researched kind win over IGDB", () => {
    const d = describeOf({ gameModes: [1, 2, 3], mpOfflineMax: 2, mpOfflineCoop: true }, [agent("localCoop", "false"), agent("onlineCoop", "true")]);
    expect(d.coop).toMatchObject({ value: "online", verified: true });
  });

  it("a false kind is not a false co-op", () => {
    // An online-co-op game has localCoop false; that must not read as "Versus".
    const d = describeOf({ gameModes: [1, 2, 3], mpOfflineCoop: false, mpOnlineCoop: true, mpOnlineMax: 2 });
    expect(d.coop.none).toBe(false);
    expect(d.versus).toBe(false);
  });
});

describe("togetherness", () => {
  it("is Together when players play at once and Taking turns when they alternate", () => {
    expect(describeOf({ gameModes: [1, 2], mpOfflineMax: 2 }, [agent("simultaneousPlay", "true")]).together).toMatchObject({ value: "simultaneous", label: "Together" });
    expect(describeOf({ gameModes: [1, 2], mpOfflineMax: 2 }, [agent("simultaneousPlay", "false")]).together).toMatchObject({ value: "alternating", label: "Taking turns" });
  });

  it("Super Mario Kart plays together, Donkey Kong Country takes turns", () => {
    const kart = shortOf({ gameModes: [1, 2], mpOfflineMax: 2 }, [agent("simultaneousPlay", "true")]);
    const dkc = shortOf({ gameModes: [1, 2, 3], mpOfflineMax: 2, mpOfflineCoop: true }, [agent("simultaneousPlay", "false")]);
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
    expect(describeOf({ mpOfflineMax: 4 }).versus).toBe(false);
  });
});

describe("the compact line", () => {
  it("says Multiplayer when there is more than one player and nothing finer", () => {
    expect(shortOf(null, [agent("multiplayer", "true")])).toBe("Multiplayer");
  });

  it("keeps a lone range as a sentence and a qualified one as digits", () => {
    expect(shortOf({ gameModes: [1], mpOfflineMax: 1 })).toBe("1 player");
    expect(shortOf({ mpOfflineMax: 4 })).toBe("Up to 4 players");
    expect(shortOf({ gameModes: [1, 2, 3], mpOfflineMax: 4, mpOfflineCoop: true })).toBe("1–4 · Local co-op · Together");
  });

  it("drops the least important qualifier first when there is no room", () => {
    const d = describeOf({ gameModes: [1, 2, 3], mpOfflineMax: 4, mpOfflineCoop: true });
    expect(playersShort(d, 1)).toBe("1–4 · Local co-op");
    expect(playersShort(d, 0)).toBe("1–4 players");
  });

  it("uses the shortest spelling of a qualifier where a card has no room", () => {
    const d = describeOf({ gameModes: [1, 2, 3], mpOfflineMax: 4, mpOfflineCoop: true, mpOnlineCoop: true });
    expect(playersShort(d, 1)).toBe("1–4 · Local + online co-op");
    expect(playersShort(d, 1, true)).toBe("1–4 · Local + online");
  });

  it("falls back to the co-op kind when there is no count", () => {
    expect(shortOf({ gameModes: [1, 2, 3] })).toBe("Co-op");
    expect(shortOf({ gameModes: [1, 2, 3], mpOfflineCoop: true })).toBe("Local co-op · Together");
  });
});

describe("confidence", () => {
  it("is exact for a counted game, mode for one IGDB only tagged, unknown for nothing", () => {
    expect(describeOf({ gameModes: [1, 2], mpOfflineMax: 2 }).tier).toBe("exact");
    expect(describeOf({ gameModes: [1, 2, 3] }).tier).toBe("mode");
    expect(describeOf(null).tier).toBe("unknown");
  });

  it("keeps a single-player-only count crisp and a co-op-derived one soft", () => {
    // "1" restates game_modes rather than inferring across facts.
    expect(describeOf({ gameModes: [1] })).toMatchObject({ tier: "exact", inferred: false });
    // A count taken from the co-op maximum is only a floor on the real one.
    expect(describeOf({ gameModes: [1, 2, 3], mpOfflineCoopMax: 4 })).toMatchObject({ tier: "mode", inferred: true });
  });

  it("marks a hand-set or researched fact verified, and an inferred one inferred", () => {
    expect(describeOf({ gameModes: [1, 2] }, [agent("maxPlayers", "2")])).toMatchObject({ verified: true, inferred: false });
    const inferred = describeOf({ gameModes: [1, 2, 3], mpOfflineMax: 2, mpOfflineCoop: true });
    expect(inferred).toMatchObject({ verified: false, inferred: true });
    expect(describeOf(null)).toMatchObject({ verified: false, inferred: false });
  });

  it("keeps the ✓ for a hand-set fact the line has no room to show", () => {
    // Only fact is "yes, multiplayer" — no count to render, still verified.
    expect(describeOf(null, [byHand("multiplayer", "true")]).verified).toBe(true);
    // Only fact is how it is played — no count, so no "Together" label, but
    // the provenance is about the fact, not about the room to show it.
    const sim = describeOf(null, [byHand("simultaneousPlay", "true")]);
    expect(sim.together.label).toBeNull();
    expect(sim.verified).toBe(true);
  });

  it("never renders unknown as a no", () => {
    const d = describeOf({ gameModes: [] });
    expect(d.short).toBe("? players");
    expect(d.coop).toMatchObject({ value: null, none: false });
    expect(d.versus).toBe(false);
  });

  it("explains each tier in words", () => {
    expect(tierHint("exact")).toMatch(/exact/i);
    expect(tierHint("mode")).toMatch(/igdb/i);
    expect(tierHint("unknown")).toMatch(/no player data/i);
  });
});

describe("what a card renders", () => {
  it("prefers the brief line, falls back to the full one, then to '? players'", () => {
    const players = { label: "1–4 · Local co-op · Together", brief: "1–4 · Local co-op" };
    expect(playersLineLabel(players, true)).toBe("1–4 · Local co-op");
    expect(playersLineLabel(players)).toBe("1–4 · Local co-op · Together");
    expect(playersLineLabel({ label: "1 player", brief: "" }, true)).toBe("1 player");
    expect(playersLineLabel({ label: "", brief: "" }, true)).toBe("? players");
    expect(playersLineLabel({ label: "", brief: "" })).toBe("? players");
  });

  it("names the three filter modes in the same words as the cards", () => {
    expect(MODE_LABELS).toEqual({ coop: "Co-op", versus: "Versus", together: "Together" });
  });
});
