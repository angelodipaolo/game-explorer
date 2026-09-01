import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { normalizeTitle } from "@/lib/catalog/normalize";
import { prisma } from "@/lib/db";
import { EnrichmentError } from "@/lib/enrichment/service";
import { journalImages } from "@/lib/journal/image";
import { manualImages } from "@/lib/manuals/image";
import { deleteImage as deleteMapImage } from "@/lib/maps/image";
import { musicFiles } from "@/lib/music/audio";
import { platformLabel, resolvePlatform } from "@/lib/platforms";

/**
 * The `OwnedGame` record itself, over HTTP (GAMEEXPLOR-0028).
 *
 * Every *sub-resource* of a game — codes, tags, maps, facts, bookmarks,
 * manuals, music — has had an API for a while. The game did not. Import was
 * the only way one got in and a batch rollback the only way one came out, so
 * an agent asked to "put every Sonic game in a series" could not even do step
 * one: turn the word "sonic" into a set of ids. Scraping the HTML or opening
 * `prisma/dev.db` are the two things CLAUDE.md forbids outright, because the
 * database in a checkout is a disposable copy and the collection lives on the
 * mini. An HTTP search endpoint is the only thing an agent on another machine
 * can honestly reach.
 *
 * Three deliberate limits shape this file:
 *
 * 1. **`q`, `platform` and paging are the whole query surface.** No filter
 *    DSL, no GraphQL, no re-export of the shelf's filter model. The shelf
 *    filters client-side from one page load (`src/lib/filters.ts`) because it
 *    is answering "what should we play tonight" across 800 games at once;
 *    this endpoint answers "which row is "Super Metroid"", which is a
 *    different question with a much smaller answer.
 * 2. **One Prisma query per request.** `loadShelf()` in `src/lib/collection.ts`
 *    exists to build view models for pages and loads the whole collection with
 *    its facts, tags and play state. Reusing it to find three rows would read
 *    every row on the shelf, so the search is a real `where` with `contains`
 *    and keyset paging instead.
 * 3. **No "add a game" path.** Games still enter through the staged import API
 *    so every addition stays one undoable batch. This file corrects and
 *    removes; it never creates.
 */

/** A page nobody asked to size. Fifty rows is a comfortable read for an agent and one small query. */
export const DEFAULT_LIMIT = 50;
/** The ceiling. Two hundred rows is most of a platform, and past that the caller wants paging, not a bigger page. */
export const MAX_LIMIT = 200;

/**
 * One owned copy, carrying everything an agent needs to act on it **without a
 * second call**.
 *
 * `igdbId` is the load-bearing one. `SeriesEntry` membership is by IGDB id and
 * not by owned id (see `src/lib/series/service.ts` — a series lists games,
 * owned or not), so a workflow that searches the shelf and then builds a series
 * out of the hits would otherwise need a round trip per game just to learn the
 * number. `coverImageId` and `firstReleaseYear` are here for the same reason:
 * they are what a reporting agent shows a person, and they are one join away
 * rather than one request away.
 *
 * `name` is the catalog name when the copy is linked and the shelf's own title
 * otherwise — the same rule `ShelfGame.name` follows, so a game is called the
 * same thing here as everywhere else. Note that `q` matches the shelf title
 * (see `titleSearchClause`), so on the rare copy whose catalog name diverges
 * from the shelf spelling, you search for one and read back the other.
 */
export type GameRow = {
  ownedGameId: string;
  igdbId: number | null;
  name: string;
  platform: string;
  platformLabel: string;
  quantity: number;
  coverImageId: string | null;
  firstReleaseYear: number | null;
};

/**
 * One copy plus how much is already hanging off it, so an agent can look
 * before it writes: "this game already has four Game Genie codes and a
 * manual" is the difference between enriching a gap and duplicating work.
 *
 * `music` is not in the ticket's list because the music domain landed
 * (GAMEEXPLOR-0025) after it was written. It is counted here for exactly the
 * reason the other five are: it is a sub-resource with an agent write path.
 * Play sessions and journal entries are deliberately *not* counted — they have
 * no agent write path at all, and a count is the first step towards one.
 */
export type GameDetail = GameRow & {
  counts: { codes: number; maps: number; bookmarks: number; manuals: number; tags: number; music: number };
};

export type GameList = { games: GameRow[]; nextCursor: string | null };

/** The columns a `GameRow` is built from, and nothing more. */
const ROW_COLUMNS = {
  id: true,
  title: true,
  platform: true,
  quantity: true,
  catalogGameId: true,
  catalogGame: { select: { name: true, coverImageId: true, firstReleaseDate: true } },
} as const;

type RowShape = Prisma.OwnedGameGetPayload<{ select: typeof ROW_COLUMNS }>;

function toRow(o: RowShape): GameRow {
  return {
    ownedGameId: o.id,
    igdbId: o.catalogGameId,
    name: o.catalogGame?.name ?? o.title,
    platform: o.platform,
    platformLabel: platformLabel(o.platform),
    quantity: o.quantity,
    coverImageId: o.catalogGame?.coverImageId ?? null,
    firstReleaseYear: o.catalogGame?.firstReleaseDate ? o.catalogGame.firstReleaseDate.getUTCFullYear() : null,
  };
}

/* ------------------------------------------------------------------ searching */

/**
 * Turn a search phrase into the tokens every hit must contain.
 *
 * The obvious implementation — one `contains` with the whole phrase — is
 * wrong, and it is worth writing down why, because it looks right. The shelf
 * stores `normalizedTitle`, which is already lower-cased and
 * punctuation-stripped (`src/lib/catalog/normalize.ts`), so "Sonic 2" and
 * "sonic 2" both normalize to `sonic 2` and case and punctuation stop being a
 * problem for free. But `"Sonic the Hedgehog 2"` normalizes to
 * `sonic the hedgehog 2`, which does **not** contain the substring `sonic 2`.
 * A phrase match would fail the one search the ticket was opened for.
 *
 * So every token of the query must appear somewhere in the title, in any
 * order: `sonic` ✓ and `2` ✓ both sit in `sonic the hedgehog 2`. That is also
 * what makes `duck tales` find `DuckTales` — both tokens are substrings of
 * `ducktales` — without a second spelling table.
 *
 * **`sonic2`.** A query with no space at all is additionally split where
 * letters meet digits, which is the `compactKey` case from `normalize.ts`
 * viewed from the other side: `sonic2` becomes `sonic` + `2` and lands on the
 * same two tokens the spaced query produced. The split is confined to
 * single-token queries on purpose — someone who typed spaces has already said
 * where the boundaries are, and splitting further only invents them.
 *
 * **And only when the leading letters are a word.** `t2` must not become
 * `t` + `2`: a one-character token is a substring of nearly every title, so
 * splitting there turns a two-character abbreviation into a page of noise
 * across 800 rows. Below two leading letters the query stays whole, finds
 * nothing, and says so — which is the honest answer to an abbreviation this
 * endpoint cannot expand. The rule is about the *split*: a bare `2` typed as
 * its own word is still load-bearing and is never dropped.
 *
 * What this deliberately does not reach: an all-letters, space-free query for
 * a spaced title — `ducktales` for a shelf row spelled `Duck Tales`. Nothing
 * can split that without a dictionary, and doing it properly means storing a
 * compact key column, which is a schema change this ticket does not make. The
 * reverse direction (spaced query, compact title) works, which is the one that
 * comes up: people type the spaces.
 *
 * Two honest costs of substring matching, both accepted because this is a
 * search endpoint and not a resolver — the caller reads the names back:
 * a short numeric token is a substring anywhere it appears, so
 * `final fantasy 7` also matches `Final Fantasy 17`; and a one- or
 * two-character word matches broadly for the same reason, which is why a
 * query short enough to be mostly noise is better spelled out than trimmed.
 */
export function searchTokens(q: string): string[] {
  const normalized = normalizeTitle(q);
  if (!normalized) return [];
  const words = normalized.split(" ").filter(Boolean);
  if (words.length !== 1) return words;
  // One word: split it where letters meet digits, so `sonic2` reads as `sonic 2`
  // — but only when what comes first is a word rather than an initial, so `t2`
  // is left whole instead of becoming the two commonest characters on the shelf.
  const word = words[0];
  return /^[a-z]{2,}[0-9]/.test(word) ? (word.match(/[a-z]+|[0-9]+/g) ?? words) : words;
}

/**
 * The Prisma `where` fragment for `q`, or `null` when no title filter was
 * asked for at all.
 *
 * **"No `q`" and "a `q` that matches nothing" are different answers**, and
 * collapsing them is how a search endpoint hands back the entire collection
 * with a 200 and no hint that it ignored you. `normalizeTitle` keeps only
 * `[a-z0-9]`, so `?q=---` and `?q=星のカービィ` both reduce to nothing; if that
 * were `null` the caller would get every game on the shelf, one keystroke away
 * from `DELETE /api/games/:id`.
 *
 * So a blank or absent `q` means "list the shelf" and is `null`, while a `q`
 * that had characters in it and produced no tokens is a `400` — the same
 * stance `platformClause` takes on a console this app has never heard of, and
 * for the same reason. An empty page would be the worst of the three: it reads
 * as "you do not own 星のカービィ", which is a claim this endpoint is in no
 * position to make.
 *
 * Exported and pure so the matching rule can be pinned down in a unit test
 * without a database, which is where the "sonic 2" case above is actually
 * guaranteed.
 *
 * `contains` and not `mode: "insensitive"`: Prisma does not support the
 * insensitive mode on SQLite at all, and it is not needed — `normalizedTitle`
 * is lower-case on both sides of the comparison.
 */
export function titleSearchClause(q: string | undefined | null): Prisma.OwnedGameWhereInput | null {
  const asked = q?.trim();
  if (!asked) return null;
  const tokens = searchTokens(asked);
  if (!tokens.length) {
    throw new EnrichmentError(`"${q}" has no characters this search can match — titles are indexed as lower-case letters and digits, so a query of only punctuation or non-Latin script matches nothing`, 400);
  }
  return { AND: tokens.map((t) => ({ normalizedTitle: { contains: t } })) };
}

/**
 * The paging cursor: opaque to the caller, plain keyset paging underneath.
 *
 * Not an offset. An offset walks a list that is being edited underneath it, so
 * a game deleted on page one silently skips a game on page two — exactly the
 * "no repeats, no gaps" property the acceptance criteria ask for. The key is
 * `(normalizedTitle, id)`, which is the sort order, and `id` breaks the tie so
 * two copies of the same title on different platforms cannot hide each other.
 *
 * Base64url of JSON rather than a bare id because the sort is compound: the
 * next page starts after a *pair*, and encoding it keeps callers from
 * constructing one by hand and depending on the shape.
 */
type Cursor = { t: string; id: string };

export function encodeCursor(c: Cursor): string {
  return Buffer.from(JSON.stringify(c), "utf8").toString("base64url");
}

export function decodeCursor(raw: string): Cursor {
  try {
    const parsed = JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as Cursor;
    if (typeof parsed?.t !== "string" || typeof parsed?.id !== "string") throw new Error("shape");
    return parsed;
  } catch {
    // A cursor is echoed back from a previous page, never composed. One that
    // does not decode is a caller bug, and answering "page one" instead would
    // restart the walk without saying so.
    throw new EnrichmentError("cursor is not one this endpoint issued — pass back the nextCursor from the previous page", 400);
  }
}

/** `(normalizedTitle, id) > (t, id)` — the keyset half of the where clause. */
function afterCursor(c: Cursor): Prisma.OwnedGameWhereInput {
  return { OR: [{ normalizedTitle: { gt: c.t } }, { AND: [{ normalizedTitle: c.t }, { id: { gt: c.id } }] }] };
}

/**
 * `platform` is repeatable (`?platform=nes&platform=snes`) and each value goes
 * through `resolvePlatform`, so `?platform=Super Nintendo` and
 * `?platform=snes` are one query. An unrecognised platform is a `400` rather
 * than an empty page: "no games" and "I have never heard of that console" look
 * identical in a result set, and only one of them is worth retrying.
 */
export const listGamesSchema = z.object({
  q: z.string().trim().max(200).optional(),
  platform: z.array(z.string().trim().min(1)).max(20).optional(),
  limit: z.coerce.number().int().min(1).max(MAX_LIMIT).default(DEFAULT_LIMIT),
  cursor: z.string().min(1).max(500).optional(),
});
export type ListGamesQuery = z.infer<typeof listGamesSchema>;

/**
 * Read the query string the way a caller writes one.
 *
 * Two things `Object.fromEntries(searchParams)` — what the other query routes
 * in this app use — gets wrong for this endpoint, so the parsing lives here
 * where it can be tested rather than in the route:
 *
 * 1. **`platform` is repeatable**, and `fromEntries` keeps only the last
 *    value, which would silently turn `?platform=nes&platform=snes` into
 *    "snes" and answer a question nobody asked.
 * 2. **An empty parameter means the caller did not set one.** `?limit=` comes
 *    from a shell that templated `?limit=$LIMIT` with `LIMIT` unset — a
 *    mistake, but one whose intent is plainly "the default". Zod sees `""`,
 *    not `null`, and would 400 it. An empty `q` is the same thing and already
 *    lists the shelf, so all four read alike. This is deliberately *not* the
 *    same case as `?q=---`, where the caller typed real characters and meant
 *    them.
 */
export function parseListQuery(params: URLSearchParams): ListGamesQuery {
  const one = (name: string) => params.get(name) || undefined;
  const platform = params.getAll("platform").filter((p) => p.trim() !== "");
  return listGamesSchema.parse({ q: one("q"), platform: platform.length ? platform : undefined, limit: one("limit"), cursor: one("cursor") });
}

function platformClause(input: string[] | undefined): Prisma.OwnedGameWhereInput | null {
  if (!input?.length) return null;
  const slugs = input.map((p) => {
    const hit = resolvePlatform(p);
    if (!hit) throw new EnrichmentError(`unknown platform "${p}" — see src/lib/platforms.ts for the slugs and aliases this app knows`, 400);
    return hit.slug;
  });
  return { platform: { in: [...new Set(slugs)] } };
}

/**
 * List and search owned copies. One query, whatever the filters are.
 *
 * `limit + 1` rows are read so `nextCursor` can be null on the last page. The
 * alternative — always returning a cursor and letting the caller discover the
 * end by getting an empty page — costs every walk one extra request and makes
 * "is there more" unanswerable from a single response.
 *
 * Copies, not games: a title owned on NES and on SNES is two rows here, each
 * with its own `ownedGameId`, because everything you can do to a game through
 * this API — patch it, delete it, hang a code off it — happens to one copy.
 * `groupShelf` collapses them for the browse pages; that is a display decision
 * and it does not belong in an id-handing endpoint.
 */
export async function listGames(query: ListGamesQuery): Promise<GameList> {
  const clauses = [titleSearchClause(query.q), platformClause(query.platform), query.cursor ? afterCursor(decodeCursor(query.cursor)) : null].filter(
    (c): c is Prisma.OwnedGameWhereInput => c !== null,
  );
  const rows = await prisma.ownedGame.findMany({
    where: clauses.length ? { AND: clauses } : undefined,
    orderBy: [{ normalizedTitle: "asc" }, { id: "asc" }],
    take: query.limit + 1,
    // `normalizedTitle` comes along only to build the cursor — it is the sort
    // key, and re-deriving it from `title` here would quietly break paging the
    // day `normalizeTitle` changes and the stored column has not been rebuilt.
    select: { ...ROW_COLUMNS, normalizedTitle: true },
  });
  const page = rows.slice(0, query.limit);
  const last = rows.length > query.limit ? page[page.length - 1] : null;
  return {
    games: page.map(toRow),
    nextCursor: last ? encodeCursor({ t: last.normalizedTitle, id: last.id }) : null,
  };
}

/**
 * One copy with its sub-resource counts.
 *
 * `_count` is a join in the same statement, not six follow-up queries — which
 * matters because the whole point of the counts is to save the caller round
 * trips, and paying for them here would just move the cost.
 */
export async function gameById(ownedGameId: string): Promise<GameDetail | null> {
  const row = await prisma.ownedGame.findUnique({
    where: { id: ownedGameId },
    select: { ...ROW_COLUMNS, _count: { select: { codes: true, maps: true, bookmarks: true, manuals: true, tags: true, music: true } } },
  });
  if (!row) return null;
  const { _count, ...rest } = row;
  return { ...toRow(rest), counts: { codes: _count.codes, maps: _count.maps, bookmarks: _count.bookmarks, manuals: _count.manuals, tags: _count.tags, music: _count.music } };
}

async function requireGame(ownedGameId: string) {
  const owned = await prisma.ownedGame.findUnique({ where: { id: ownedGameId }, select: { id: true, title: true, platform: true, catalogGameId: true } });
  if (!owned) throw new EnrichmentError("owned game not found", 404);
  return owned;
}

/* -------------------------------------------------------------------- writing */

/**
 * Correcting a record, not editing one. The fields here are the ones the
 * importer can get wrong — the platform it read off a spreadsheet, the number
 * of copies it counted from repeated rows, the condition, and the catalog link
 * it scored. Title is not among them: changing a title changes
 * `normalizedTitle`, which is half the unique key and the sort key, and the
 * honest way to replace a shelf entry is to import the right one and delete
 * the wrong one — which is exactly what this API now makes possible.
 *
 * `igdbId` and `catalogGameId` are two spellings of one field, because the
 * schema calls the column `catalogGameId` while it holds an IGDB id and every
 * other endpoint in this app calls that number `igdbId`. Accepting both and
 * refusing a body that sets them to different values is cheaper than making
 * the caller guess, and much cheaper than half-linking a game because they
 * guessed wrong. Explicit `null` unlinks.
 */
export const gamePatchSchema = z
  .object({
    platform: z.string().trim().min(1).max(60).optional(),
    quantity: z.number().int().min(1).max(999).optional(),
    condition: z.string().trim().max(120).nullish(),
    igdbId: z.number().int().positive().nullish(),
    catalogGameId: z.number().int().positive().nullish(),
  })
  .refine((p) => p.igdbId === undefined || p.catalogGameId === undefined || p.igdbId === p.catalogGameId, {
    message: "igdbId and catalogGameId are the same field — send one, or send both with the same value",
  })
  .refine((p) => Object.values(p).some((v) => v !== undefined), { message: "nothing to change" });
export type GamePatch = z.infer<typeof gamePatchSchema>;

/**
 * Pulling a catalog row (and its parent backfill) for a re-link.
 *
 * Injectable for the same reason `Hydrate` is in the series service: the unit
 * tests must never reach IGDB, and the live implementation is imported lazily
 * so nothing that merely reads a game drags the IGDB client into its module
 * graph. `syncCatalog` with its default options is what import runs, stubs and
 * all, so a game re-linked by hand ends up with exactly the catalog a game
 * imported correctly would have had — including the similar-game stubs the
 * game page's "similar" strip renders.
 */
export type SyncLink = (igdbId: number) => Promise<{ fetched: number[] }>;

const liveSync: SyncLink = async (igdbId) => {
  const { syncCatalog } = await import("@/lib/catalog/sync");
  return syncCatalog([igdbId]);
};

/**
 * Re-link (or unlink) the catalog game, going through `src/lib/catalog/sync.ts`
 * rather than writing the column.
 *
 * Writing `catalogGameId` on its own would point the copy at a row that may
 * not exist, and `OwnedGame.catalogGame` is a real foreign key — so the
 * optimistic version either explodes on a constraint or, worse, succeeds for
 * an id that happens to be in the catalog as a bare stub and gives the game a
 * page with no summary, no screenshots and no player data.
 *
 * Two failures are reported rather than papered over:
 *
 * - **IGDB unreachable.** The request fails and nothing is written. A copy
 *   half-linked to an id with no catalog row behind it is worse than a copy
 *   still linked to the wrong game, because the wrong game at least renders.
 * - **IGDB refuses the id.** Every `/games` query in this app carries a
 *   `game_type` filter (see `decisions.md`), so a DLC, an expansion, a pack or
 *   a romhack simply does not come back — which is why `SyncReport` reports
 *   `fetched` at all. An id that is not in `fetched` gets a 422 naming the
 *   reason instead of a foreign-key error.
 */
async function relinkCatalog(igdbId: number, sync: SyncLink): Promise<void> {
  let report: { fetched: number[] };
  try {
    report = await sync(igdbId);
  } catch (e) {
    throw new EnrichmentError(`could not reach IGDB to link game ${igdbId} — nothing was changed. ${e instanceof Error ? e.message : "unknown error"}`, 502);
  }
  if (!report.fetched.includes(igdbId)) {
    throw new EnrichmentError(`IGDB returned no game ${igdbId} of a type this app catalogs — DLC, expansions, packs and romhacks are filtered out. Nothing was changed.`, 422);
  }
}

/**
 * Apply a correction. The platform change is the one that can collide:
 * `@@unique([normalizedTitle, platform])` means moving a copy onto a platform
 * where the same title already sits is a merge, not an edit, and this API does
 * not merge — the caller wanted `quantity` on the row that is already there
 * and a `DELETE` on this one.
 */
export async function updateGame(ownedGameId: string, patch: GamePatch, sync: SyncLink = liveSync): Promise<GameDetail> {
  await requireGame(ownedGameId);

  let platform: string | undefined;
  if (patch.platform !== undefined) {
    const hit = resolvePlatform(patch.platform);
    if (!hit) throw new EnrichmentError(`unknown platform "${patch.platform}" — see src/lib/platforms.ts for the slugs and aliases this app knows`, 400);
    platform = hit.slug;
  }

  // `undefined` is "leave it alone" and explicit `null` is "unlink"; the two
  // spellings of the field are folded first so the rest reads as one decision.
  const wanted = patch.igdbId !== undefined ? patch.igdbId : patch.catalogGameId;
  const link: { catalogGameId: number | null; matchConfidence: null; matchSource: string | null } | undefined =
    wanted === undefined
      ? undefined
      : wanted === null
        ? { catalogGameId: null, matchConfidence: null, matchSource: null }
        : // `manual`, and confidence null: nothing scored this. The schema says
          // as much — "0..1 confidence of the automatic match, null when set by
          // hand" — and leaving a stale score from the match this is correcting
          // would be a lie about how the new link was chosen.
          { catalogGameId: wanted, matchConfidence: null, matchSource: "manual" };
  if (link?.catalogGameId != null) await relinkCatalog(link.catalogGameId, sync);

  try {
    await prisma.ownedGame.update({
      where: { id: ownedGameId },
      data: { platform, quantity: patch.quantity, condition: patch.condition === undefined ? undefined : patch.condition || null, ...(link ?? {}) },
    });
  } catch (e) {
    if ((e as { code?: string }).code === "P2002") {
      throw new EnrichmentError("this title is already on the shelf for that platform — raise that copy's quantity and delete this row instead", 409);
    }
    throw e;
  }
  return (await gameById(ownedGameId))!;
}

/** What a delete took with it, so the caller can report something truer than "ok". */
export type DeleteReport = {
  ownedGameId: string;
  title: string;
  platform: string;
  /**
   * Rows whose blobs were cleared, per directory — not a count of files that
   * were actually on disk. The unlink is `fs.rm(force: true)`, so a map row
   * whose image was never uploaded counts here exactly like one whose image
   * was; distinguishing them would mean a `stat` per row to report a number
   * nobody acts on.
   */
  files: { maps: number; manualPages: number; journalPhotos: number; musicTracks: number };
};

/**
 * Remove one copy — the row, everything the schema cascades, and the bytes on
 * disk that a cascade cannot reach.
 *
 * **The blob half is the reason this is a service and not a `deleteMany`.**
 * `GameMap`, `ManualPage`, `JournalEntry` and `MusicTrack` each key a file
 * under `data/`, and SQL knows nothing about `data/maps/`. That gap is
 * documented in CLAUDE.md as the one every blob domain shares — an import
 * rollback that removes an `OwnedGame` takes the rows and leaves the bytes —
 * and a `DELETE` route that reproduced it would turn a rare accident into a
 * routine one. So the ids are read first, the row is deleted, and only then
 * are the files unlinked.
 *
 * That order matters and it is the same order `removeMap`, `deletePage`,
 * `deleteEntry` and `removeTrack` all use: a rolled-back delete that had
 * already unlinked the pixels would leave a map that renders nothing. Bytes
 * left behind by a failed unlink are inert; rows left behind by a successful
 * one are broken.
 *
 * The open-run refusal is the other half. Play state is derived from the
 * `PlaySession` log and `endedAt is null` is the only definition of "playing
 * now", so deleting a copy mid-run destroys a record of something that is
 * actually happening, silently and with no undo — this is not an import batch.
 * The check and the delete share one transaction, because a check that runs
 * before the write it guards outside a transaction is not a check (the same
 * argument `assertNoOpenRun` makes in the play service).
 */
export async function deleteGame(ownedGameId: string): Promise<DeleteReport> {
  const removed = await prisma.$transaction(async (tx) => {
    const copy = await tx.ownedGame.findUnique({
      where: { id: ownedGameId },
      select: {
        id: true,
        title: true,
        platform: true,
        maps: { select: { id: true } },
        manuals: { select: { pages: { select: { id: true } } } },
        journal: { where: { kind: "photo" }, select: { id: true } },
        music: { select: { id: true } },
      },
    });
    if (!copy) throw new EnrichmentError("owned game not found", 404);

    const open = await tx.playSession.findFirst({ where: { ownedGameId, endedAt: null }, select: { id: true, startedAt: true } });
    if (open) {
      throw new EnrichmentError(
        `"${copy.title}" has a run in progress (started ${open.startedAt.toISOString().slice(0, 10)}) — finish or delete that run before deleting the copy`,
        409,
        { openSessionId: open.id },
      );
    }

    await tx.ownedGame.delete({ where: { id: ownedGameId } });
    return {
      title: copy.title,
      platform: copy.platform,
      mapIds: copy.maps.map((m) => m.id),
      pageIds: copy.manuals.flatMap((m) => m.pages.map((p) => p.id)),
      photoIds: copy.journal.map((j) => j.id),
      trackIds: copy.music.map((t) => t.id),
    };
  });

  await Promise.all([
    ...removed.mapIds.map((id) => deleteMapImage(id)),
    ...removed.pageIds.map((id) => manualImages.delete(id)),
    ...removed.photoIds.map((id) => journalImages.delete(id)),
    ...removed.trackIds.map((id) => musicFiles.delete(id)),
  ]);

  return {
    ownedGameId,
    title: removed.title,
    platform: removed.platform,
    files: { maps: removed.mapIds.length, manualPages: removed.pageIds.length, journalPhotos: removed.photoIds.length, musicTracks: removed.trackIds.length },
  };
}
