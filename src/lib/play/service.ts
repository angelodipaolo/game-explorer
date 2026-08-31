import type { OwnedGame, PlaySession, QueueEntry } from "@prisma/client";
import { z } from "zod";
import { whenSchema } from "@/lib/dates";
import { prisma } from "@/lib/db";
import { EnrichmentError } from "@/lib/enrichment/service";

/**
 * Play history and the "up next" queue for owned copies.
 *
 * **Play state is derived from this log, never stored on the game.** There is
 * no `OwnedGame.status` and there must never be one: a status column cannot
 * represent playing a game twice, and this collection is full of games that
 * get replayed every few years. "Playing now" is exactly `endedAt is null`.
 *
 * Unlike codes and maps — which share one API between the owner and a research
 * skill because they are public facts about a game — **there is no agent write
 * path here at all**. Nobody but the owner can produce a playthrough, and an
 * agent inventing one would be fabricating a memory.
 *
 * The queue lives in this module rather than its own because `startSession`
 * must dequeue in the same transaction: a game cannot be both "up next" and
 * "in progress", and two modules would eventually disagree.
 */

export const PLAY_OUTCOMES = ["playing", "completed", "abandoned"] as const;
export type PlayOutcome = (typeof PLAY_OUTCOMES)[number];

/** A queue whose end you cannot see is a backlog, not a plan. */
export const MAX_QUEUE = 50;

const note = z.string().trim().max(500).nullish();
const blank = (v: string | null | undefined) => (v === undefined ? undefined : v || null);
/** A bare "2026-08-30" means local midnight, not UTC — see src/lib/dates.ts. */
const when = whenSchema;

export const startSessionSchema = z.object({ startedAt: when.optional(), note });
export type StartSessionInput = z.infer<typeof startSessionSchema>;

export const finishSessionSchema = z.object({ outcome: z.enum(["completed", "abandoned"]), endedAt: when.optional(), note });
export type FinishSessionInput = z.infer<typeof finishSessionSchema>;

const doneOutcome = z.enum(["completed", "abandoned"]).optional();

/**
 * A run that already happened, in one of exactly two shapes: dated, or
 * undated. A union rather than an object with three optional fields, because
 * "I played this, I do not remember when" and "I played this from March to
 * May" are different claims and half of one is not a run — `{ startedAt }`
 * with no end, or `{ undated: true, endedAt }`, must not parse.
 *
 * The undated branch spells the dates out as `z.undefined()` rather than
 * omitting them: objects strip unknown keys, so leaving them out would quietly
 * *accept* dates alongside `undated: true` and then throw them away.
 *
 * Note where this does and does not run. It is the contract for callers that
 * reach `logPastSession` directly, and it is what makes half a run — `{
 * startedAt }` with no end, `{ undated: true, endedAt }` — fail to typecheck.
 * The HTTP path does NOT parse it: `POST /api/games/:id/sessions` parses
 * `createSessionSchema` (one flat object, because the same route also starts a
 * run) and then rejects the contradictory combinations itself, so that the
 * body carries a sentence a person can act on rather than zod's `invalid_union`
 * nested two levels deep. Two statements of one rule: change them together.
 */
export const pastSessionSchema = z.union([
  z.object({ startedAt: when, endedAt: when, undated: z.literal(false).optional(), outcome: doneOutcome, note }),
  z.object({
    undated: z.literal(true),
    startedAt: z.undefined({ error: "an undated run has no dates — leave startedAt out" }).optional(),
    endedAt: z.undefined({ error: "an undated run has no dates — leave endedAt out" }).optional(),
    outcome: doneOutcome,
    note,
  }),
]);
export type PastSessionInput = z.infer<typeof pastSessionSchema>;

/**
 * The POST body for `/api/games/:id/sessions`: start a run, log one that
 * already happened when `endedAt` is given, or log one whose dates are lost
 * when `undated` is set. One route, because "I played this last year", "I
 * played this at some point" and "I am playing this now" are the same record.
 */
export const createSessionSchema = z.object({
  startedAt: when.optional(),
  endedAt: when.optional(),
  undated: z.boolean().optional(),
  outcome: z.enum(PLAY_OUTCOMES).optional(),
  note,
});

/**
 * PATCH: finish, reopen, or correct. `endedAt: null` is the reopen — explicit
 * null clears the column, absent leaves it alone (see `blank`).
 *
 * `undated` is editable both ways: ticking it forgets the dates, clearing it
 * is the "I remembered when that was" path and must arrive with real ones.
 */
export const sessionPatchSchema = z.object({
  startedAt: when.optional(),
  endedAt: when.nullish(),
  undated: z.boolean().optional(),
  outcome: z.enum(PLAY_OUTCOMES).optional(),
  note,
});
export type SessionPatch = z.infer<typeof sessionPatchSchema>;

export const enqueueSchema = z.object({ ownedGameId: z.string().min(1), position: z.number().int().min(0).max(MAX_QUEUE).optional(), note });
export const reorderQueueSchema = z.object({ orderedIds: z.array(z.string().min(1)).max(MAX_QUEUE) });

/** A Prisma transaction client — what every check that guards a write must run on. */
type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

async function requireOwned(ownedGameId: string) {
  const owned = await prisma.ownedGame.findUnique({ where: { id: ownedGameId }, select: { id: true } });
  if (!owned) throw new EnrichmentError("owned game not found", 404);
}

async function requireSession(sessionId: string) {
  const s = await prisma.playSession.findUnique({ where: { id: sessionId } });
  if (!s) throw new EnrichmentError("play session not found", 404);
  return s;
}

/**
 * One open run per copy. "Playing it twice at once" is a data-entry mistake,
 * not a use case.
 *
 * Always called with a transaction client, never the bare `prisma`: a check
 * that runs before the write it guards is not a check at all. Two taps on
 * "Start playing" are two requests ~50ms apart, and both would pass a check
 * made outside the transaction that creates the row.
 */
async function assertNoOpenRun(tx: Tx, ownedGameId: string, exceptId?: string) {
  const open = await tx.playSession.findFirst({ where: { ownedGameId, endedAt: null, id: exceptId ? { not: exceptId } : undefined }, select: { id: true } });
  if (open) throw new EnrichmentError("this copy already has a run in progress — finish it first", 409, { openSessionId: open.id });
}

/**
 * The database backstops the rule with a partial unique index
 * (`PlaySession_one_open_run`, created by hand in its own migration because
 * Prisma cannot express a filtered index). Two concurrent writers that both
 * pass the check still lose one to the constraint, so translate that into the
 * same 409 the check produces rather than leaking a 500.
 */
function asOpenRunConflict(e: unknown): never {
  const code = (e as { code?: string }).code;
  if (code === "P2002") throw new EnrichmentError("this copy already has a run in progress — finish it first", 409);
  throw e;
}

function assertOrder(startedAt: Date, endedAt: Date | null | undefined) {
  if (endedAt && endedAt.getTime() < startedAt.getTime()) throw new EnrichmentError("a run cannot end before it started", 400);
}

/**
 * Start a run. **Removes any queue entry for that copy in the same
 * transaction** — a game cannot be both up next and in progress, and doing
 * this as a follow-up write (or from the client) is how the two end up
 * disagreeing.
 */
export async function startSession(ownedGameId: string, input: StartSessionInput = {}): Promise<PlaySession> {
  await requireOwned(ownedGameId);
  return prisma
    .$transaction(async (tx) => {
      await assertNoOpenRun(tx, ownedGameId);
      const session = await tx.playSession.create({
        data: { ownedGameId, startedAt: input.startedAt ?? new Date(), outcome: "playing", note: blank(input.note) ?? null },
      });
      await tx.queueEntry.deleteMany({ where: { ownedGameId } });
      await renumber(tx);
      return session;
    })
    .catch(asOpenRunConflict);
}

/** Close an open run. `endedAt` defaults to now; an end before the start is a 400. */
export async function finishSession(sessionId: string, input: FinishSessionInput): Promise<PlaySession> {
  const s = await requireSession(sessionId);
  const endedAt = input.endedAt ?? new Date();
  assertOrder(s.startedAt, endedAt);
  return prisma.playSession.update({ where: { id: sessionId }, data: { endedAt, outcome: input.outcome, note: blank(input.note) } });
}

/**
 * Clear `endedAt` and go back to "playing" — how a mis-tapped Finish is undone.
 * Not available to an undated run: its `startedAt` is the day it was typed in,
 * so "still playing it" would resume from a moment that never happened.
 */
export async function reopenSession(sessionId: string): Promise<PlaySession> {
  const s = await requireSession(sessionId);
  if (s.undated) throw new EnrichmentError("an undated run cannot be reopened — give it dates first", 400);
  return prisma
    .$transaction(async (tx) => {
      await assertNoOpenRun(tx, s.ownedGameId, sessionId);
      return tx.playSession.update({ where: { id: sessionId }, data: { endedAt: null, outcome: "playing" } });
    })
    .catch(asOpenRunConflict);
}

/**
 * A run that already happened. Must be closed — this never creates an open
 * run, undated or otherwise.
 *
 * An undated run is stamped at both ends with the moment it was recorded.
 * Those are placeholders, not dates: `endedAt is null` is the one definition
 * of "playing now", so a run with no end would claim to be in progress, which
 * is the opposite of what "I played this years ago" means. `undated` is the
 * flag that tells every reader the two timestamps mean nothing.
 */
export async function logPastSession(ownedGameId: string, input: PastSessionInput): Promise<PlaySession> {
  await requireOwned(ownedGameId);
  const outcome = input.outcome ?? "completed";
  if (input.undated) {
    const recordedAt = new Date();
    return prisma.playSession.create({
      data: { ownedGameId, startedAt: recordedAt, endedAt: recordedAt, undated: true, outcome, note: blank(input.note) ?? null },
    });
  }
  assertOrder(input.startedAt, input.endedAt);
  return prisma.playSession.create({
    data: { ownedGameId, startedAt: input.startedAt, endedAt: input.endedAt, outcome, note: blank(input.note) ?? null },
  });
}

/**
 * Correct a run: dates, outcome, note. `endedAt: null` reopens it (and so
 * takes the one-open-run rule with it); an outcome is kept consistent with
 * `endedAt` — an open run is always "playing", a closed one never is.
 */
export async function updateSession(sessionId: string, patch: SessionPatch): Promise<PlaySession> {
  const s = await requireSession(sessionId);
  const undated = patch.undated ?? s.undated;

  // An undated run can never be open: its timestamps are placeholders, so
  // there is no point in it to resume from. Reopening one means giving it real
  // dates first.
  if (undated && patch.endedAt === null) throw new EnrichmentError("an undated run cannot be reopened — give it dates first", 400);
  // Dates and "I do not know the dates" are contradictory in one patch. The
  // way to date a run you had forgotten is to send `undated: false` with them,
  // which is the path below.
  if (undated && (patch.startedAt !== undefined || patch.endedAt !== undefined)) {
    throw new EnrichmentError("send undated: false with the dates to give this run a date range", 400);
  }
  // Clearing the flag is the "I remembered when that was" edit, and it is only
  // real if it arrives with dates: the stored ones are placeholders, so
  // keeping them would silently claim the run happened the day it was typed
  // in. A run that was already dated has real ones and needs no help.
  if (patch.undated === false && s.undated && (patch.startedAt === undefined || !patch.endedAt)) {
    throw new EnrichmentError("give this run a start and an end date to say when it happened", 400);
  }

  // Turning the flag on stamps fresh placeholders (see logPastSession) and
  // closes the run; leaving an already-undated run undated keeps the ones it
  // has, so editing its note does not move it up the list.
  const recordedAt = new Date();
  const startedAt = undated ? (s.undated ? s.startedAt : recordedAt) : patch.startedAt ?? s.startedAt;
  const endedAt = undated ? (s.undated ? s.endedAt ?? s.startedAt : recordedAt) : patch.endedAt === undefined ? s.endedAt : patch.endedAt;
  assertOrder(startedAt, endedAt);
  if (endedAt && patch.outcome === "playing") throw new EnrichmentError('a finished run cannot have the outcome "playing" — clear endedAt to reopen it', 400);

  // Outcome follows endedAt: open runs are always "playing", and closing one
  // without saying how it went means it was finished.
  const outcome = !endedAt ? "playing" : patch.outcome ?? (s.outcome === "playing" ? "completed" : s.outcome);

  return prisma
    .$transaction(async (tx) => {
      // Reopening a closed run is subject to the same one-open-run rule, and
      // has to be checked in the transaction that performs the reopen.
      if (!endedAt && s.endedAt) await assertNoOpenRun(tx, s.ownedGameId, sessionId);
      return tx.playSession.update({ where: { id: sessionId }, data: { startedAt, endedAt, outcome, undated, note: blank(patch.note) } });
    })
    .catch(asOpenRunConflict);
}

/**
 * Remove a run. Its journal entries survive with `sessionId: null` — a deleted
 * run never destroys writing (the FK does this; `service.test.ts` asserts it).
 */
export async function deleteSession(sessionId: string): Promise<void> {
  await requireSession(sessionId);
  await prisma.playSession.delete({ where: { id: sessionId } });
}

/**
 * One copy's runs, newest first — with the undated ones last.
 *
 * An undated run's `startedAt` is the day it was typed in, so sorting on dates
 * alone would file "I played this at some point in the nineties" between last
 * month and last week. `undated` sorts first (false before true in SQLite), so
 * every run with real dates comes before every run without, and the undated
 * ones fall back to most-recently-recorded among themselves.
 */
export async function sessionsFor(ownedGameId: string): Promise<PlaySession[]> {
  return prisma.playSession.findMany({ where: { ownedGameId }, orderBy: [{ undated: "asc" }, { startedAt: "desc" }, { createdAt: "desc" }] });
}

/**
 * `playing` while a run is open, `played` once one has finished, `never` with
 * no rows at all. Deliberately two-valued at the filter level: unlike every
 * IGDB-derived verdict this is not sparse data, so "no sessions" means you
 * have never played it, which is a fact and not a gap.
 */
export type PlayState = {
  status: "playing" | "played" | "never";
  runs: number;
  /** Null with a `played` status too, when every run on the copy is undated. */
  lastPlayedAt: Date | null;
  openSessionId: string | null;
};

export const NEVER_PLAYED: PlayState = { status: "never", runs: 0, lastPlayedAt: null, openSessionId: null };

/**
 * Play state for many copies at once. **This is the only query `loadShelf` may
 * make about sessions** — one pass over the log for the whole shelf, never a
 * per-game round trip. Ids with no rows come back as `never`.
 */
export async function playStateFor(ownedGameIds: string[]): Promise<Map<string, PlayState>> {
  const out = new Map<string, PlayState>();
  if (!ownedGameIds.length) return out;
  for (const id of ownedGameIds) out.set(id, { ...NEVER_PLAYED });

  const rows = await prisma.playSession.findMany({
    where: { ownedGameId: { in: ownedGameIds } },
    select: { id: true, ownedGameId: true, startedAt: true, endedAt: true, undated: true },
  });
  for (const r of rows) {
    const state = out.get(r.ownedGameId);
    if (!state) continue;
    state.runs++;
    // "Last played" is the latest end, or the start of a run still going — but
    // never an undated run's timestamps, which are the moment it was recorded.
    // A copy whose only runs are undated is therefore `played` with a null
    // `lastPlayedAt`: you have played it, and when is genuinely not known.
    const touched = r.undated ? null : r.endedAt ?? r.startedAt;
    if (touched && (!state.lastPlayedAt || touched > state.lastPlayedAt)) state.lastPlayedAt = touched;
    if (r.endedAt === null) {
      state.status = "playing";
      state.openSessionId = r.id;
    } else if (state.status === "never") {
      state.status = "played";
    }
  }
  return out;
}

export type PlayingCopy = OwnedGame & { catalogGame: { name: string; coverImageId: string | null; firstReleaseDate: Date | null } | null };
export type OpenSession = PlaySession & { ownedGame: PlayingCopy };

/**
 * Every open run, most recently started first — the data behind `/playing`.
 * Carries the same slice of the catalog entry as `loadQueue`, so the two lists
 * on that page render from what they were handed and neither needs a second
 * pass over `OwnedGame`.
 */
export async function listOpenSessions(): Promise<OpenSession[]> {
  return prisma.playSession.findMany({
    where: { endedAt: null },
    include: { ownedGame: { include: { catalogGame: { select: { name: true, coverImageId: true, firstReleaseDate: true } } } } },
    orderBy: [{ startedAt: "desc" }, { createdAt: "desc" }],
  });
}

/* ------------------------------------------------------------------ queue */

/**
 * Write `order` out as positions 0..n-1. Two passes through negative numbers:
 * `position` is not unique in the schema, but a half-applied order should
 * never be readable either, and the transaction is what makes that true.
 */
async function applyOrder(tx: Tx, order: string[]) {
  for (const [i, ownedGameId] of order.entries()) await tx.queueEntry.update({ where: { ownedGameId }, data: { position: -1 - i } });
  for (const [i, ownedGameId] of order.entries()) await tx.queueEntry.update({ where: { ownedGameId }, data: { position: i } });
}

/** Positions are dense 0..n-1; every write that can leave a hole calls this. */
async function renumber(tx: Tx) {
  const rows = await tx.queueEntry.findMany({ orderBy: [{ position: "asc" }, { addedAt: "asc" }], select: { ownedGameId: true } });
  await applyOrder(tx, rows.map((r) => r.ownedGameId));
}

/**
 * Add a game to the queue, or move the one already there. Appends by default.
 * A copy with an open run is a 400: it is already being played, so "up next"
 * is meaningless for it.
 */
export async function enqueue(ownedGameId: string, input: { position?: number; note?: string | null } = {}): Promise<QueueEntry> {
  await requireOwned(ownedGameId);

  return prisma.$transaction(async (tx) => {
    // Inside the transaction: a run started concurrently must not leave the
    // game both queued and in progress.
    const open = await tx.playSession.findFirst({ where: { ownedGameId, endedAt: null }, select: { id: true } });
    if (open) throw new EnrichmentError("this copy is already in progress — it cannot also be up next", 400, { openSessionId: open.id });

    const rows = await tx.queueEntry.findMany({ orderBy: [{ position: "asc" }, { addedAt: "asc" }] });
    const existing = rows.find((r) => r.ownedGameId === ownedGameId);
    if (!existing && rows.length >= MAX_QUEUE) throw new EnrichmentError(`the queue is full at ${MAX_QUEUE} games`, 409);

    // Compute the order this write wants, then renumber to match. Splicing a
    // list is the only way a *move* lands where you asked: an insert-and-shift
    // is off by one whenever the entry moves further down than it started.
    const others = rows.filter((r) => r.ownedGameId !== ownedGameId).map((r) => r.ownedGameId);
    const target = Math.min(input.position ?? (existing ? existing.position : others.length), others.length);
    const order = [...others];
    order.splice(target, 0, ownedGameId);

    if (existing) await tx.queueEntry.update({ where: { id: existing.id }, data: { note: blank(input.note) } });
    else await tx.queueEntry.create({ data: { ownedGameId, position: order.length, note: blank(input.note) ?? null } });

    await applyOrder(tx, order);
    return tx.queueEntry.findUniqueOrThrow({ where: { ownedGameId } });
  });
}

/** Remove a game from the queue and close the gap. 404 when it was not queued. */
export async function dequeue(ownedGameId: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const { count } = await tx.queueEntry.deleteMany({ where: { ownedGameId } });
    if (!count) throw new EnrichmentError("that game is not in the queue", 404);
    await renumber(tx);
  });
}

/**
 * Reorder the whole queue in one transaction. The list must be a permutation
 * of what is queued now — a stale client that silently drops an entry gets a
 * 400 rather than deleting a row by omission.
 */
export async function reorderQueue(orderedIds: string[]): Promise<QueueEntry[]> {
  return prisma.$transaction(async (tx) => {
    const current = await tx.queueEntry.findMany({ select: { ownedGameId: true } });
    const have = new Set(current.map((e) => e.ownedGameId));
    const want = new Set(orderedIds);
    if (want.size !== orderedIds.length) throw new EnrichmentError("the same game is listed twice", 400);
    if (have.size !== want.size || [...have].some((id) => !want.has(id))) {
      throw new EnrichmentError("the order must list exactly the games currently in the queue", 400, { queued: [...have] });
    }
    await applyOrder(tx, orderedIds);
    return tx.queueEntry.findMany({ orderBy: { position: "asc" } });
  });
}

export type QueuedGame = QueueEntry & { ownedGame: OwnedGame & { catalogGame: { name: string; coverImageId: string | null; firstReleaseDate: Date | null } | null } };

/** The queue in order, with enough game detail to render a row on `/playing`. */
export async function loadQueue(): Promise<QueuedGame[]> {
  return prisma.queueEntry.findMany({
    include: { ownedGame: { include: { catalogGame: { select: { name: true, coverImageId: true, firstReleaseDate: true } } } } },
    orderBy: [{ position: "asc" }, { addedAt: "asc" }],
  });
}

export type { PlaySession, QueueEntry };
