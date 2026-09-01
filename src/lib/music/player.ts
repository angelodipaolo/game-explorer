/**
 * The pure browser half of background music (GAMEEXPLOR-0025): what a pathname
 * means, and what this device remembers.
 *
 * Kept out of the component so both can be unit-tested and so `/settings` and
 * the player agree on one key and one shape. No React, no `window` at module
 * scope — importing this on the server must be inert.
 *
 * The setting is **per browser**, not per collection: `localStorage`, no
 * database, no cookie, nothing that travels. Music on the owner's phone is not
 * music for a visitor on the tunnel, and default-off is what makes opening a
 * link on someone else's shelf a safe thing to do.
 */

export type MusicSettings = {
  enabled: boolean;
  /** 0..1, straight onto `HTMLMediaElement.volume`. */
  volume: number;
};

/** Off. Sound that starts itself is the thing everyone hates about the web. */
export const DEFAULT_MUSIC_SETTINGS: MusicSettings = { enabled: false, volume: 0.35 };

/** Namespaced so it never collides with the shelf's saved view. */
export const MUSIC_SETTINGS_KEY = "game-explorer:music";

/**
 * Dispatched on `window` after a write, because `storage` events only fire in
 * *other* tabs — without this the toggle on /settings and the player mounted
 * in the same layout would disagree until a reload.
 */
export const MUSIC_SETTINGS_EVENT = "game-explorer:music-settings";

type StorageLike = { getItem(key: string): string | null; setItem(key: string, value: string): void };

/**
 * Only a real, finite number is a volume. `Number(null)` and `Number([])` are
 * both `0`, so coercing first would turn a corrupted store into a toggle that
 * is on and silent with nothing to explain it — the worst possible failure for
 * a setting whose only feedback is sound. Out-of-range numbers still clamp:
 * -5 is 0 and 1e9 is 1, both of which are what the writer meant.
 */
const clampVolume = (v: unknown): number => {
  if (typeof v !== "number" || !Number.isFinite(v)) return DEFAULT_MUSIC_SETTINGS.volume;
  return Math.min(1, Math.max(0, v));
};

/** Anything that is not exactly the shape we wrote falls back to the default, field by field. */
export function parseSettings(raw: string | null | undefined): MusicSettings {
  if (!raw) return DEFAULT_MUSIC_SETTINGS;
  try {
    const data: unknown = JSON.parse(raw);
    if (!data || typeof data !== "object") return DEFAULT_MUSIC_SETTINGS;
    const rec = data as Record<string, unknown>;
    return {
      enabled: rec.enabled === true,
      volume: "volume" in rec ? clampVolume(rec.volume) : DEFAULT_MUSIC_SETTINGS.volume,
    };
  } catch {
    return DEFAULT_MUSIC_SETTINGS;
  }
}

/**
 * `localStorage`, or null. A private window can *throw* on the property
 * access itself, not just on the read — hence the try around `typeof`.
 */
export function browserStorage(): StorageLike | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

export function readSettings(storage: StorageLike | null = browserStorage()): MusicSettings {
  if (!storage) return DEFAULT_MUSIC_SETTINGS;
  try {
    return parseSettings(storage.getItem(MUSIC_SETTINGS_KEY));
  } catch {
    return DEFAULT_MUSIC_SETTINGS;
  }
}

/**
 * Never throws: a browser that refuses to store just forgets the choice on
 * reload. Always announces, though — the event is what the player mounted in
 * the root layout is subscribed to, and it has to fire even when the write
 * itself was swallowed, or a private window would have a toggle that does
 * nothing at all.
 */
export function writeSettings(settings: MusicSettings, storage: StorageLike | null = browserStorage()): void {
  const value: MusicSettings = { enabled: settings.enabled, volume: clampVolume(settings.volume) };
  try {
    storage?.setItem(MUSIC_SETTINGS_KEY, JSON.stringify(value));
  } catch {}
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent<MusicSettings>(MUSIC_SETTINGS_EVENT, { detail: value }));
}

/**
 * The `useSyncExternalStore` triple, so both components read this device's
 * choice without a `useEffect` + `setState` — the same shape `Section` uses for
 * its saved open state, and the one the lint rule against setState-in-an-effect
 * steers you toward. The server snapshot is the default (off), which is also
 * what the first client render produces, so hydration matches and the real
 * value arrives from React itself.
 *
 * `getSnapshot` must return a *stable* reference while nothing has changed, or
 * React re-renders forever — hence memoizing on the raw stored string.
 */
let snapshotRaw: string | null | undefined;
let snapshotValue: MusicSettings = DEFAULT_MUSIC_SETTINGS;

export function settingsSnapshot(): MusicSettings {
  let raw: string | null = null;
  try {
    raw = browserStorage()?.getItem(MUSIC_SETTINGS_KEY) ?? null;
  } catch {
    raw = null;
  }
  if (raw !== snapshotRaw) {
    snapshotRaw = raw;
    snapshotValue = parseSettings(raw);
  }
  return snapshotValue;
}

export function serverSettingsSnapshot(): MusicSettings {
  return DEFAULT_MUSIC_SETTINGS;
}

/** This tab's own writes (the CustomEvent) and other tabs' (the `storage` event). */
export function subscribeSettings(onChange: () => void): () => void {
  const onStorage = (e: StorageEvent) => {
    if (e.key === null || e.key === MUSIC_SETTINGS_KEY) onChange();
  };
  window.addEventListener(MUSIC_SETTINGS_EVENT, onChange);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(MUSIC_SETTINGS_EVENT, onChange);
    window.removeEventListener("storage", onStorage);
  };
}

/** Whether this browser will remember anything at all, for the note on /settings. */
export function canStoreSettings(): boolean {
  return browserStorage() !== null;
}

/**
 * The one route pattern that plays music: a game page and its two subpages.
 *
 * The player is pathname-driven rather than wired into the game page, so a
 * single `<audio>` element in the root layout survives every navigation.
 * `/game/x/map` and `/game/x/manual` are the same game — walking into the map
 * must not restart the track — and everything else (`/`, `/shelf`, `/flip`,
 * `/series`) returns null, which is the player's stop signal.
 */
const GAME_PATH = /^\/game\/([^/]+)(?:\/(?:map|manual))?\/?$/;

export function gameIdFromPathname(pathname: string | null | undefined): string | null {
  if (!pathname) return null;
  const m = GAME_PATH.exec(pathname);
  return m ? m[1] : null;
}

/** What `GET /api/games/:id/music` hands back: an id to fetch and a name. No paths. */
export type PlayableTrack = { id: string; title: string };

/**
 * One track at random, optionally not the one already playing.
 *
 * Lives here rather than in the service because the *browser* is what
 * chooses — the server would have to pick per request, and every soft
 * navigation back to the same game would then re-pick. `random` is injected so
 * the choice is testable; it returns a value in [0,1) like `Math.random`. With
 * one track, and that track excluded, the answer is that track again: silence
 * would be the more surprising outcome.
 */
export function pickTrack<T extends PlayableTrack>(tracks: T[], random: () => number = Math.random, excludeId?: string | null): T | null {
  if (!tracks.length) return null;
  const pool = excludeId ? tracks.filter((t) => t.id !== excludeId) : tracks;
  const from = pool.length ? pool : tracks;
  const i = Math.min(from.length - 1, Math.max(0, Math.floor(random() * from.length)));
  return from[i];
}
