import fs from "node:fs/promises";
import path from "node:path";
import { EMPTY_INDEX, MusicManifestError, buildIndex, isSafeTrackId, parseManifest, type MusicIndex, type MusicTrack } from "./manifest";

/**
 * The disk half of the music library (GAMEEXPLOR-0025).
 *
 * `data/music/` holds the owner's own soundtrack files plus `index.json`, the
 * manifest. Like `data/maps/`, `data/journal/` and `data/manuals/` it is
 * gitignored, outside `db:snapshot`, and archived by `npm run backup`. Unlike
 * those three it has no database rows at all — the manifest *is* the record —
 * which is why `createImageStore` is not reused here: that store keys files by
 * row id, and there is no row.
 *
 * What it does borrow is the store's stance on ids. Nothing in this module
 * takes a path from a caller. A request names a track id; the manifest turns
 * that id into a relative file; and `resolveTrackPath` refuses anything that
 * resolves outside the directory — including through a symlink, which is the
 * one escape a string check cannot see.
 */

/** `MUSIC_DIR` overrides for tests, exactly as `MAPS_DIR`/`MANUALS_DIR` do. */
export const MUSIC_DIR = process.env.MUSIC_DIR ?? path.resolve(process.cwd(), "data/music");
export const MUSIC_MANIFEST_PATH = path.join(MUSIC_DIR, "index.json");

/** A soundtrack file the app will stream. MP3 only — decided with the owner; MIDI is not served. */
export const TRACK_CONTENT_TYPE = "audio/mpeg";

/**
 * Turn a manifest-declared relative file into an absolute path inside
 * `MUSIC_DIR`, or throw.
 *
 * The string checks in `isSafeTrackFile` already refuse `..`, absolute paths
 * and backslashes; this is the second, positional check: resolve, then require
 * the result to sit under the directory. `path.resolve` is what makes it
 * total — any traversal that survived the string check collapses here.
 */
export function resolveTrackPath(dir: string, file: string): string {
  const root = path.resolve(dir);
  const full = path.resolve(root, file);
  const rel = path.relative(root, full);
  if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) throw new MusicManifestError(`track file escapes the music directory: ${JSON.stringify(file.slice(0, 120))}`);
  return full;
}

type CacheEntry = { key: string; index: MusicIndex };
let cache: CacheEntry | null = null;

/**
 * The parsed manifest, re-read when the file changes.
 *
 * Keyed on mtime+size rather than held forever: the owner edits this file by
 * hand (or a skill does), and having to restart the service to hear a new
 * track would make the feature feel broken. A missing file is the normal state
 * on a machine with no music — it caches as "empty", not as an error.
 *
 * A manifest that fails to parse is logged once per change and treated as
 * empty. Bad JSON silences the music; it never takes down a game page.
 */
export async function loadIndex(): Promise<MusicIndex> {
  let key: string;
  try {
    const stat = await fs.stat(MUSIC_MANIFEST_PATH);
    key = `${stat.mtimeMs}:${stat.size}`;
  } catch {
    key = "absent";
  }
  if (cache?.key === key) return cache.index;
  if (key === "absent") {
    cache = { key, index: EMPTY_INDEX };
    return EMPTY_INDEX;
  }
  let index = EMPTY_INDEX;
  try {
    index = buildIndex(parseManifest(JSON.parse(await fs.readFile(MUSIC_MANIFEST_PATH, "utf8"))));
  } catch (e) {
    console.warn(`music: ignoring ${MUSIC_MANIFEST_PATH} — ${e instanceof Error ? e.message : String(e)}`);
  }
  cache = { key, index };
  return index;
}

/** Tests and the skill's verify step: drop the memoized manifest. */
export function clearIndexCache(): void {
  cache = null;
}

export type TrackFile = { track: MusicTrack; path: string; size: number };

/**
 * Locate the bytes behind a track id, or `null` when there is no such track —
 * an id that is not in the manifest, a manifest entry whose file was never
 * copied across, or an id that could not name a file in the first place.
 *
 * `fs.realpath` is the last gate: a symlink inside `data/music/` pointing at
 * `~/.ssh/id_ed25519` resolves out of the directory, and only a resolved-path
 * check catches it. It runs on both sides so a symlinked `data/` itself (a
 * perfectly ordinary way to keep blobs on another disk) still works.
 */
export async function findTrack(trackId: string): Promise<TrackFile | null> {
  if (!isSafeTrackId(trackId)) return null;
  const index = await loadIndex();
  const hit = index.byTrackId.get(trackId);
  if (!hit) return null;
  let full: string;
  try {
    full = resolveTrackPath(MUSIC_DIR, hit.track.file);
  } catch {
    return null;
  }
  try {
    const [realRoot, realFile] = await Promise.all([fs.realpath(MUSIC_DIR), fs.realpath(full)]);
    const rel = path.relative(realRoot, realFile);
    if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) {
      console.warn(`music: track ${trackId} resolves outside ${realRoot} — refusing`);
      return null;
    }
    const stat = await fs.stat(realFile);
    if (!stat.isFile() || stat.size === 0) return null;
    return { track: hit.track, path: realFile, size: stat.size };
  } catch {
    // Missing file: a manifest entry whose MP3 was not copied across yet.
    return null;
  }
}

/** Read `[start, end]` inclusive out of a file, for a `Range` response. */
export async function readTrackBytes(file: string, start: number, end: number): Promise<Buffer> {
  const length = end - start + 1;
  const handle = await fs.open(file, "r");
  try {
    const buf = Buffer.alloc(length);
    const { bytesRead } = await handle.read(buf, 0, length, start);
    return bytesRead === length ? buf : buf.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

export type ByteRange = { start: number; end: number };

/**
 * Parse a `Range: bytes=…` header against a known size.
 *
 * `null` means "no range asked for, send the whole thing"; `"unsatisfiable"`
 * means answer `416`. Only a single range is honoured — Safari and Chrome ask
 * for one at a time when scrubbing audio, and a multipart/byteranges body
 * would be a lot of machinery for a feature that plays one track start to end.
 * A multi-range request therefore falls back to the whole file, which is a
 * legal response to any `Range`.
 */
export function parseRange(header: string | null, size: number): ByteRange | null | "unsatisfiable" {
  if (!header) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m) return null;
  const [, rawStart, rawEnd] = m;
  if (rawStart === "" && rawEnd === "") return null;
  if (rawStart === "") {
    // `bytes=-500`: the last 500 bytes.
    const suffix = Number(rawEnd);
    if (!Number.isFinite(suffix) || suffix <= 0) return "unsatisfiable";
    return { start: Math.max(0, size - suffix), end: size - 1 };
  }
  const start = Number(rawStart);
  if (!Number.isFinite(start) || start >= size) return "unsatisfiable";
  const end = rawEnd === "" ? size - 1 : Math.min(size - 1, Number(rawEnd));
  if (end < start) return "unsatisfiable";
  return { start, end };
}
