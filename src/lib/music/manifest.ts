import { z } from "zod";
import { normalizeTitle } from "@/lib/catalog/normalize";

/**
 * The music manifest — the pure half of GAMEEXPLOR-0025.
 *
 * Background music while you browse a game page comes from the owner's own
 * soundtrack files, copied by hand into `data/music/` on the machine that
 * serves the app. There is no table, no migration and no upload route: a
 * handful of MP3s and one JSON file is the whole feature, and the JSON file —
 * `data/music/index.json` — is the **only** thing that maps a track id to a
 * file on disk. Nothing enumerates the directory, and no request ever names a
 * path.
 *
 * Two rules the rest of the module exists to keep:
 *
 * 1. **A game with no entry is silent.** Music is opt-in per game, written
 *    down by a human. There is no fuzzy fallback that "probably" fits.
 * 2. **A track id can never become an arbitrary path.** Ids are matched
 *    against the same allowlist `isSafeImageId` uses for the blob stores
 *    (src/lib/media/image-store.ts), and the `file` field is validated as a
 *    relative path with no `..`, no leading `/` and no backslash *before* the
 *    disk half resolves it and re-checks containment. Two independent checks,
 *    because a `%2F..%2F` in a URL segment has already read files off this
 *    disk once (see the note in image-store.ts).
 */

/** The same shape the blob stores accept: letters, digits, `-`, `_`. No dot, no slash. */
const SAFE_TRACK_ID = /^[A-Za-z0-9_-]+$/;

export function isSafeTrackId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 128 && SAFE_TRACK_ID.test(value);
}

/**
 * A `file` is a path **relative to `data/music/`** and nothing else: one or
 * more plain segments ending in `.mp3`. Rejected here, before the disk half
 * ever joins it: absolute paths, `..` and `.` segments, backslashes, drive
 * letters, NUL, and a URL-encoded traversal (`%2e%2e` never matches the
 * segment pattern, and the resolver decodes nothing).
 */
const SEGMENT = /^[A-Za-z0-9][A-Za-z0-9 _.'()&,+-]*$/;

export function isSafeTrackFile(value: unknown): value is string {
  if (typeof value !== "string" || !value || value.length > 300) return false;
  if (value.includes("\\") || value.includes("\0")) return false;
  if (value.startsWith("/") || /^[A-Za-z]:/.test(value)) return false;
  if (!/\.mp3$/i.test(value)) return false;
  const segments = value.split("/");
  return segments.length <= 4 && segments.every((s) => s !== "" && s !== "." && s !== ".." && !s.endsWith(".") && SEGMENT.test(s));
}

const trackSchema = z.object({
  /** Stable, URL-safe, unique across the whole manifest — this is what `/api/music/tracks/:trackId` names. */
  id: z.string().refine(isSafeTrackId, "track id must be letters, digits, - or _"),
  /** What the player would show if it ever showed anything. Keep it the piece's name, not the filename. */
  title: z.string().trim().min(1).max(200),
  /** Relative to `data/music/`. Never absolute, never containing `..`. */
  file: z.string().refine(isSafeTrackFile, "file must be a relative .mp3 path inside data/music/"),
});
export type MusicTrack = z.infer<typeof trackSchema>;

const gameSchema = z.object({
  /**
   * The match key: the **IGDB id**, not an owned-copy id. One game on two
   * platforms is one soundtrack, and re-importing the shelf does not orphan
   * the music. Optional only for the shelf copy IGDB has no entry for, which
   * is then matched by `title`/`aliases`.
   */
  igdbId: z.number().int().positive().nullish(),
  /** The game as a human reads it. Also the first title the fallback match tries. */
  title: z.string().trim().min(1).max(200),
  /**
   * Alternate spellings for a soundtrack folder whose title differs from the
   * shelf's — `Zelda II` vs `Zelda 2`. Only ever consulted for a copy with no
   * catalog link, and only on an exact normalized match: an alias is a human
   * saying "these are the same game", not a similarity score.
   */
  aliases: z.array(z.string().trim().min(1).max(200)).max(20).default([]),
  tracks: z.array(trackSchema).min(1).max(200),
});
export type MusicGame = z.infer<typeof gameSchema>;

export const musicManifestSchema = z
  .object({
    version: z.literal(1),
    games: z.array(gameSchema).max(2000).default([]),
  })
  .superRefine((manifest, ctx) => {
    // A duplicate track id would make `/api/music/tracks/:id` ambiguous, and a
    // duplicate IGDB id would make "which soundtrack" depend on array order.
    // Both are a hand-edited-JSON mistake worth failing loudly on.
    const ids = new Set<string>();
    const igdbIds = new Set<number>();
    for (const game of manifest.games) {
      if (game.igdbId != null) {
        if (igdbIds.has(game.igdbId)) ctx.addIssue({ code: "custom", message: `duplicate igdbId ${game.igdbId}`, path: ["games"] });
        igdbIds.add(game.igdbId);
      }
      for (const track of game.tracks) {
        if (ids.has(track.id)) ctx.addIssue({ code: "custom", message: `duplicate track id ${track.id}`, path: ["games"] });
        ids.add(track.id);
      }
    }
  });

export type MusicManifest = z.infer<typeof musicManifestSchema>;

export const EMPTY_MANIFEST: MusicManifest = { version: 1, games: [] };

/** Thrown by `parseManifest`. The routes turn it into "no music", never a 500 that takes the page down. */
export class MusicManifestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MusicManifestError";
  }
}

export function parseManifest(data: unknown): MusicManifest {
  const parsed = musicManifestSchema.safeParse(data);
  if (!parsed.success) throw new MusicManifestError(parsed.error.issues.map((i) => `${i.path.join(".") || "manifest"}: ${i.message}`).join("; "));
  return parsed.data;
}

/** Lookup tables built once per manifest read, so a page view is two map hits. */
export type MusicIndex = {
  manifest: MusicManifest;
  byIgdbId: Map<number, MusicGame>;
  byTitle: Map<string, MusicGame>;
  byTrackId: Map<string, { track: MusicTrack; game: MusicGame }>;
};

export function buildIndex(manifest: MusicManifest): MusicIndex {
  const byIgdbId = new Map<number, MusicGame>();
  const byTitle = new Map<string, MusicGame>();
  const byTrackId = new Map<string, { track: MusicTrack; game: MusicGame }>();
  for (const game of manifest.games) {
    if (game.igdbId != null) byIgdbId.set(game.igdbId, game);
    for (const name of [game.title, ...game.aliases]) {
      const key = normalizeTitle(name);
      // First entry wins: two games claiming one alias is the human's problem,
      // and silently reassigning a soundtrack is worse than ignoring the second.
      if (key && !byTitle.has(key)) byTitle.set(key, game);
    }
    for (const track of game.tracks) byTrackId.set(track.id, { track, game });
  }
  return { manifest, byIgdbId, byTitle, byTrackId };
}

export const EMPTY_INDEX: MusicIndex = buildIndex(EMPTY_MANIFEST);

/**
 * The soundtrack for one owned copy, or `[]`.
 *
 * The IGDB id decides whenever there is one — that is what "match by catalog
 * identity" means, and it is why the same soundtrack plays for the NES and the
 * Switch copy. Titles are the fallback for a copy IGDB does not know, and only
 * as an exact normalized string: `normalizeTitle` folds case, punctuation and
 * `&`/`and`, and nothing else. No prefix matching, no distance score — an
 * unconfident match is silence, by design.
 */
export function tracksFor(index: MusicIndex, copy: { igdbId?: number | null; titles?: Array<string | null | undefined> }): MusicTrack[] {
  if (copy.igdbId != null) {
    const byId = index.byIgdbId.get(copy.igdbId);
    // A catalog-linked copy is answered by its id alone. Falling back to the
    // title here would let an alias override the id the owner actually matched.
    return byId ? byId.tracks : [];
  }
  for (const title of copy.titles ?? []) {
    if (!title) continue;
    const hit = index.byTitle.get(normalizeTitle(title));
    if (hit) return hit.tracks;
  }
  return [];
}
