import type { GameBookmark } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { EnrichmentError } from "@/lib/enrichment/service";
import { platformLabel } from "@/lib/platforms";
import { BOOKMARK_KINDS, MAX_BOOKMARKS_PER_GAME, isBookmarkKind, kindRank, urlKeyOf, type BookmarkKind } from "./kinds";

/**
 * Links worth keeping for one owned copy: the guide, the wiki, the longplay.
 *
 * Same stance as codes and maps — no `source`, no precedence, one API for the
 * owner and for the `find-references` skill. A bookmark is its own citation:
 * the URL *is* the source, and `why` is the line that says what it is. There
 * is therefore no `sourceUrl` here and there must never be one.
 *
 * Per copy, not per title, because that is where the rest of this data lives
 * and because a guide for the SNES release is the wrong guide for the NES
 * cartridge more often than it looks.
 */

const text = (max: number) => z.string().trim().max(max).nullish();
const blank = (v: string | null | undefined) => (v === undefined ? undefined : v || null);

/**
 * http(s) only, and refused if `URL` cannot parse it. A `javascript:` or
 * `data:` bookmark rendered as an anchor on the game page is a script the page
 * runs on tap, so the scheme check is a guard, not tidiness.
 */
const httpUrl = z
  .string()
  .trim()
  .min(1)
  .max(1000)
  .refine((v) => {
    try {
      return ["http:", "https:"].includes(new URL(v).protocol);
    } catch {
      return false;
    }
  }, "url must be an http:// or https:// address");

const fields = {
  url: httpUrl,
  title: z.string().trim().min(1).max(200),
  /** Required, and the point of the whole table: what makes this the link to open. */
  why: z.string().trim().min(1).max(300),
  note: text(500),
  position: z.number().int().min(0).max(999).optional(),
};

/** Adding one bookmark to one game. */
export const bookmarkInputSchema = z.object({ kind: z.enum(BOOKMARK_KINDS), ...fields });
export type BookmarkInput = z.infer<typeof bookmarkInputSchema>;

/** Editing one: every field optional, including the kind. */
export const bookmarkPatchSchema = z.object({
  kind: z.enum(BOOKMARK_KINDS).optional(),
  ...fields,
  url: fields.url.optional(),
  title: fields.title.optional(),
  why: fields.why.optional(),
});
export type BookmarkPatch = z.infer<typeof bookmarkPatchSchema>;

/**
 * The batch body. `kind` is a plain string on purpose: a batch of 200 with one
 * unknown kind should write the other 199 and report the one, not 400 the lot.
 * The URL is validated structurally here, because a row whose `url` will not
 * parse cannot be keyed or rendered at all.
 */
export const writeBookmarksSchema = z.object({
  bookmarks: z
    .array(z.object({ ownedGameId: z.string().min(1), kind: z.string().min(1), ...fields }))
    .min(1)
    .max(500),
});
export type BatchBookmarkInput = z.infer<typeof writeBookmarksSchema>["bookmarks"][number];

export type BookmarkWriteResult = {
  written: { ownedGameId: string; kind: string; title: string; id: string }[];
  skipped: { ownedGameId: string; kind: string; title: string; reason: string }[];
};

/** One copy's bookmarks, grouped kind by kind in BOOKMARK_KINDS order. */
export async function bookmarksFor(ownedGameId: string): Promise<GameBookmark[]> {
  const rows = await prisma.gameBookmark.findMany({ where: { ownedGameId } });
  return rows.sort((a, b) => kindRank(a.kind) - kindRank(b.kind) || a.position - b.position || a.createdAt.getTime() - b.createdAt.getTime());
}

async function requireOwned(ownedGameId: string) {
  const owned = await prisma.ownedGame.findUnique({ where: { id: ownedGameId }, select: { id: true } });
  if (!owned) throw new EnrichmentError("owned game not found", 404);
}

/** Prisma leaves a column alone when its value is `undefined` — that is the seam blank() feeds. */
function writeData(input: { url: string; title: string; why: string; note?: string | null; position?: number }) {
  return { url: input.url.trim(), title: input.title, why: input.why, note: blank(input.note), position: input.position };
}

/**
 * Add one bookmark, or refresh the one already there. The unique key is
 * (game, normalised url), so saving the same page twice updates its title and
 * `why` in place rather than stacking a duplicate — and so a skill re-run is
 * idempotent.
 */
export async function addBookmark(ownedGameId: string, input: BookmarkInput): Promise<GameBookmark> {
  await requireOwned(ownedGameId);
  const urlKey = urlKeyOf(input.url);
  const where = { ownedGameId_urlKey: { ownedGameId, urlKey } };
  const existing = await prisma.gameBookmark.findUnique({ where });
  if (!existing && (await prisma.gameBookmark.count({ where: { ownedGameId } })) >= MAX_BOOKMARKS_PER_GAME) {
    throw new EnrichmentError(`this game already has ${MAX_BOOKMARKS_PER_GAME} bookmarks`, 409);
  }
  const d = writeData(input);
  return prisma.gameBookmark.upsert({
    where,
    create: { ownedGameId, kind: input.kind, urlKey, ...d, note: d.note ?? null, position: d.position ?? 0 },
    update: { kind: input.kind, ...d },
  });
}

/**
 * Write many bookmarks across many games. Partial success by design: a bad
 * entry is reported in `skipped` with a reason and the rest still land.
 */
export async function addBookmarks(entries: BatchBookmarkInput[]): Promise<BookmarkWriteResult> {
  const result: BookmarkWriteResult = { written: [], skipped: [] };
  /** Running count per game so a batch cannot walk past the cap. */
  const counts = new Map<string, number>();
  for (const e of entries) {
    const label = { ownedGameId: e.ownedGameId, kind: e.kind, title: e.title };
    if (!isBookmarkKind(e.kind)) {
      result.skipped.push({ ...label, reason: `unknown kind — expected one of ${BOOKMARK_KINDS.join(", ")}` });
      continue;
    }
    const owned = await prisma.ownedGame.findUnique({ where: { id: e.ownedGameId }, select: { id: true } });
    if (!owned) {
      result.skipped.push({ ...label, reason: "owned game not found" });
      continue;
    }
    const urlKey = urlKeyOf(e.url);
    const where = { ownedGameId_urlKey: { ownedGameId: e.ownedGameId, urlKey } };
    const existing = await prisma.gameBookmark.findUnique({ where });
    if (!existing) {
      let n = counts.get(e.ownedGameId);
      if (n === undefined) {
        n = await prisma.gameBookmark.count({ where: { ownedGameId: e.ownedGameId } });
        counts.set(e.ownedGameId, n);
      }
      if (n >= MAX_BOOKMARKS_PER_GAME) {
        result.skipped.push({ ...label, reason: `already at the ${MAX_BOOKMARKS_PER_GAME}-bookmark limit` });
        continue;
      }
      counts.set(e.ownedGameId, n + 1);
    }
    const d = writeData(e);
    const row = await prisma.gameBookmark.upsert({
      where,
      create: { ownedGameId: e.ownedGameId, kind: e.kind, urlKey, ...d, note: d.note ?? null, position: d.position ?? 0 },
      update: { kind: e.kind, ...d },
    });
    result.written.push({ ...label, id: row.id });
  }
  return result;
}

/** Edit a bookmark. Moving it onto a sibling's URL is a 409. */
export async function updateBookmark(bookmarkId: string, patch: BookmarkPatch): Promise<GameBookmark> {
  const row = await prisma.gameBookmark.findUnique({ where: { id: bookmarkId } });
  if (!row) throw new EnrichmentError("bookmark not found", 404);
  const url = patch.url?.trim() ?? row.url;
  const urlKey = urlKeyOf(url);
  if (urlKey !== row.urlKey) {
    const clash = await prisma.gameBookmark.findUnique({ where: { ownedGameId_urlKey: { ownedGameId: row.ownedGameId, urlKey } } });
    if (clash && clash.id !== bookmarkId) throw new EnrichmentError("this game already has that link", 409);
  }
  return prisma.gameBookmark.update({
    where: { id: bookmarkId },
    data: { kind: patch.kind, url, urlKey, title: patch.title, why: patch.why, note: blank(patch.note), position: patch.position },
  });
}

export async function removeBookmark(bookmarkId: string): Promise<void> {
  const { count } = await prisma.gameBookmark.deleteMany({ where: { id: bookmarkId } });
  if (!count) throw new EnrichmentError("bookmark not found", 404);
}

export type BookmarkGap = {
  ownedGameId: string;
  title: string;
  name: string;
  platform: string;
  year: number | null;
  igdbId: number | null;
  /** What it already has, per kind — so a research pass does not redo it. */
  have: Partial<Record<BookmarkKind, number>>;
};

/**
 * Owned copies with no bookmarks at all, or — when `kinds` is given — none of
 * those kinds. Bookmarks are per copy, so the `ownedGameId` here is what a
 * batch write must use: the NES and SNES copies of one game are two gaps.
 */
export async function listBookmarkGaps(kinds?: BookmarkKind[], limit = 50, offset = 0): Promise<{ total: number; gaps: BookmarkGap[] }> {
  const owned = await prisma.ownedGame.findMany({
    include: { catalogGame: { select: { name: true, igdbId: true, firstReleaseDate: true } }, bookmarks: { select: { kind: true } } },
    orderBy: { title: "asc" },
  });
  const gaps: BookmarkGap[] = [];
  for (const g of owned) {
    const have: BookmarkGap["have"] = {};
    for (const b of g.bookmarks) if (isBookmarkKind(b.kind)) have[b.kind] = (have[b.kind] ?? 0) + 1;
    const relevant = kinds?.length ? kinds.reduce((n, k) => n + (have[k] ?? 0), 0) : g.bookmarks.length;
    if (relevant > 0) continue;
    gaps.push({
      ownedGameId: g.id,
      title: g.title,
      name: g.catalogGame?.name ?? g.title,
      platform: platformLabel(g.platform),
      year: g.catalogGame?.firstReleaseDate?.getUTCFullYear() ?? null,
      igdbId: g.catalogGame?.igdbId ?? null,
      have,
    });
  }
  return { total: gaps.length, gaps: gaps.slice(offset, offset + limit) };
}

export type { GameBookmark };
export { BOOKMARK_KINDS, MAX_BOOKMARKS_PER_GAME, hostOf, isBookmarkKind, urlKeyOf, type BookmarkKind } from "./kinds";
