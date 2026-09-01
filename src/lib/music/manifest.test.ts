import { describe, expect, it } from "vitest";
import { EMPTY_MANIFEST, MusicManifestError, buildIndex, isSafeTrackFile, isSafeTrackId, parseManifest, tracksFor } from "./manifest";

const valid = {
  version: 1,
  games: [
    {
      igdbId: 1638,
      title: "Super Mario Bros. 3",
      aliases: ["Super Mario Brothers 3"],
      tracks: [
        { id: "smb3-overworld", title: "Overworld", file: "super-mario-bros-3/01 Overworld.mp3" },
        { id: "smb3-athletic", title: "Athletic", file: "super-mario-bros-3/02 Athletic.mp3" },
      ],
    },
    { title: "Roller Games", tracks: [{ id: "roller-theme", title: "Theme", file: "roller-games/theme.mp3" }] },
  ],
};

describe("parseManifest", () => {
  it("accepts the shipped shape and defaults aliases", () => {
    const m = parseManifest(valid);
    expect(m.games).toHaveLength(2);
    expect(m.games[0].tracks[1].id).toBe("smb3-athletic");
    expect(m.games[1].aliases).toEqual([]);
    expect(m.games[1].igdbId ?? null).toBeNull();
  });

  it("rejects a manifest that is not version 1", () => {
    expect(() => parseManifest({ ...valid, version: 2 })).toThrow(MusicManifestError);
  });

  it("rejects a game with no tracks, and a track with no title", () => {
    expect(() => parseManifest({ version: 1, games: [{ title: "X", tracks: [] }] })).toThrow(MusicManifestError);
    expect(() => parseManifest({ version: 1, games: [{ title: "X", tracks: [{ id: "a", title: " ", file: "a.mp3" }] }] })).toThrow(MusicManifestError);
  });

  it("rejects duplicate track ids and duplicate igdb ids", () => {
    const dupTrack = { version: 1, games: [{ title: "A", tracks: [{ id: "t", title: "T", file: "a.mp3" }] }, { title: "B", tracks: [{ id: "t", title: "T", file: "b.mp3" }] }] };
    expect(() => parseManifest(dupTrack)).toThrow(/duplicate track id t/);
    const dupGame = { version: 1, games: [{ igdbId: 7, title: "A", tracks: [{ id: "a", title: "T", file: "a.mp3" }] }, { igdbId: 7, title: "B", tracks: [{ id: "b", title: "T", file: "b.mp3" }] }] };
    expect(() => parseManifest(dupGame)).toThrow(/duplicate igdbId 7/);
  });

  it("empty is a valid manifest — the state of a checkout with no music", () => {
    expect(parseManifest({ version: 1, games: [] })).toEqual(EMPTY_MANIFEST);
  });
});

describe("isSafeTrackId", () => {
  it("takes ids that cannot name a path", () => {
    for (const id of ["a", "smb3-overworld", "Track_01", "a".repeat(128)]) expect(isSafeTrackId(id)).toBe(true);
  });

  it("refuses anything that could traverse", () => {
    for (const id of ["", "..", "../secret", "a/b", "a\\b", "a.mp3", "/etc/passwd", "%2e%2e%2fetc", "a\0b", "a".repeat(129), 7, null, undefined, {}]) {
      expect(isSafeTrackId(id), `${String(id)} must be refused`).toBe(false);
    }
  });
});

describe("isSafeTrackFile", () => {
  it("takes a relative .mp3 under data/music/", () => {
    for (const f of ["theme.mp3", "super-mario-bros-3/01 Overworld.mp3", "Mega Man 2 (NES)/01 Dr. Wily's Castle.mp3", "a/b/c/d.mp3"]) {
      expect(isSafeTrackFile(f), f).toBe(true);
    }
  });

  it("refuses traversal, absolute paths, encoded traversal and non-mp3", () => {
    for (const f of [
      "../../.env",
      "../secret.mp3",
      "a/../../b.mp3",
      "/etc/passwd.mp3",
      "/Users/angelo/Music/non-iTunes/x.mp3",
      "C:\\music\\x.mp3",
      "music\\x.mp3",
      "%2e%2e/x.mp3",
      "%2E%2E%2Fx.mp3",
      "./x.mp3",
      "a//b.mp3",
      "x.mp3\0.txt",
      "theme.mid",
      "theme.wav",
      "theme",
      "a/b/c/d/e.mp3",
      "",
      42,
      null,
    ]) {
      expect(isSafeTrackFile(f), `${String(f)} must be refused`).toBe(false);
    }
  });
});

describe("tracksFor", () => {
  const index = buildIndex(parseManifest(valid));

  it("matches on the catalog id, not the copy", () => {
    expect(tracksFor(index, { igdbId: 1638 }).map((t) => t.id)).toEqual(["smb3-overworld", "smb3-athletic"]);
  });

  it("is silent for a catalog game with no entry", () => {
    expect(tracksFor(index, { igdbId: 99999, titles: ["Super Mario Bros. 3"] })).toEqual([]);
  });

  it("falls back to title and aliases only for an unlinked copy", () => {
    expect(tracksFor(index, { igdbId: null, titles: ["roller games"] }).map((t) => t.id)).toEqual(["roller-theme"]);
    // An alias, normalized: punctuation and case do not matter, spelling does.
    expect(tracksFor(index, { igdbId: null, titles: ["super mario brothers 3!"] }).map((t) => t.id)).toEqual(["smb3-overworld", "smb3-athletic"]);
  });

  it("is silent when nothing matches confidently", () => {
    expect(tracksFor(index, { igdbId: null, titles: ["Super Mario Bros"] })).toEqual([]);
    expect(tracksFor(index, { igdbId: null, titles: [null, undefined, ""] })).toEqual([]);
    expect(tracksFor(index, {})).toEqual([]);
  });
});
