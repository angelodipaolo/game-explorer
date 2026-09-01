import { describe, expect, it } from "vitest";
import { DEFAULT_MUSIC_SETTINGS, MUSIC_SETTINGS_KEY, gameIdFromPathname, parseSettings, pickTrack, readSettings, writeSettings } from "./player";

const store = (initial: Record<string, string> = {}) => {
  const data = { ...initial };
  return {
    data,
    getItem: (k: string) => data[k] ?? null,
    setItem: (k: string, v: string) => {
      data[k] = v;
    },
  };
};

/** A private window: the property exists and throws on use. */
const hostile = {
  getItem() {
    throw new Error("SecurityError");
  },
  setItem() {
    throw new Error("SecurityError");
  },
};

describe("settings", () => {
  it("defaults to off", () => {
    expect(DEFAULT_MUSIC_SETTINGS.enabled).toBe(false);
    expect(readSettings(store())).toEqual(DEFAULT_MUSIC_SETTINGS);
    expect(readSettings(null)).toEqual(DEFAULT_MUSIC_SETTINGS);
  });

  it("round-trips through a namespaced key", () => {
    const s = store();
    writeSettings({ enabled: true, volume: 0.5 }, s);
    expect(Object.keys(s.data)).toEqual([MUSIC_SETTINGS_KEY]);
    expect(readSettings(s)).toEqual({ enabled: true, volume: 0.5 });
  });

  it("treats junk as the default and clamps the volume", () => {
    expect(parseSettings("not json")).toEqual(DEFAULT_MUSIC_SETTINGS);
    expect(parseSettings("null")).toEqual(DEFAULT_MUSIC_SETTINGS);
    expect(parseSettings("[1,2]")).toEqual({ enabled: false, volume: DEFAULT_MUSIC_SETTINGS.volume });
    expect(parseSettings('{"enabled":"yes","volume":9}')).toEqual({ enabled: false, volume: 1 });
    expect(parseSettings('{"enabled":true,"volume":-3}')).toEqual({ enabled: true, volume: 0 });
    expect(parseSettings('{"enabled":true,"volume":"loud"}')).toEqual({ enabled: true, volume: DEFAULT_MUSIC_SETTINGS.volume });
    // `Number(null)` and `Number([])` are both 0, so a coercing parser would
    // turn a corrupt store into a toggle that is on and silent.
    expect(parseSettings('{"enabled":true,"volume":null}')).toEqual({ enabled: true, volume: DEFAULT_MUSIC_SETTINGS.volume });
    expect(parseSettings('{"enabled":true,"volume":[]}')).toEqual({ enabled: true, volume: DEFAULT_MUSIC_SETTINGS.volume });
    expect(parseSettings('{"enabled":true,"volume":{}}')).toEqual({ enabled: true, volume: DEFAULT_MUSIC_SETTINGS.volume });
    expect(parseSettings('{"enabled":true,"volume":"0.5"}')).toEqual({ enabled: true, volume: DEFAULT_MUSIC_SETTINGS.volume });
    // A real number still clamps rather than falling back.
    expect(parseSettings('{"enabled":true,"volume":0}')).toEqual({ enabled: true, volume: 0 });
  });

  it("never throws when the browser refuses to store anything", () => {
    expect(readSettings(hostile)).toEqual(DEFAULT_MUSIC_SETTINGS);
    expect(() => writeSettings({ enabled: true, volume: 1 }, hostile)).not.toThrow();
  });
});

describe("gameIdFromPathname", () => {
  it("plays on a game page and its subpages", () => {
    expect(gameIdFromPathname("/game/abc123")).toBe("abc123");
    expect(gameIdFromPathname("/game/abc123/map")).toBe("abc123");
    expect(gameIdFromPathname("/game/abc123/manual")).toBe("abc123");
    expect(gameIdFromPathname("/game/abc123/")).toBe("abc123");
  });

  it("stops everywhere else", () => {
    for (const p of ["/", "/shelf", "/flip", "/series/mario", "/playing", "/settings", "/game", "/game/", "/game/abc/map/2", "/games/abc", null, undefined, ""]) {
      expect(gameIdFromPathname(p), String(p)).toBeNull();
    }
  });
});

describe("pickTrack", () => {
  const tracks = [
    { id: "a", title: "A" },
    { id: "b", title: "B" },
    { id: "c", title: "C" },
  ];

  it("picks by the injected random, across the whole list", () => {
    expect(pickTrack(tracks, () => 0)?.id).toBe("a");
    expect(pickTrack(tracks, () => 0.5)?.id).toBe("b");
    expect(pickTrack(tracks, () => 0.99)?.id).toBe("c");
    // Math.random() can never return 1, but a bad stub must not index past the end.
    expect(pickTrack(tracks, () => 1)?.id).toBe("c");
  });

  it("has nothing to pick from an empty soundtrack", () => {
    expect(pickTrack([], () => 0)).toBeNull();
  });

  it("avoids repeating the track that just ended", () => {
    expect(pickTrack(tracks, () => 0, "a")?.id).toBe("b");
    expect(pickTrack(tracks, () => 0.99, "c")?.id).toBe("b");
  });

  it("repeats when repeating is the only option", () => {
    expect(pickTrack([tracks[0]], () => 0, "a")?.id).toBe("a");
  });

  it("spreads over the list", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) seen.add(pickTrack(tracks)!.id);
    expect(seen.size).toBe(3);
  });
});
