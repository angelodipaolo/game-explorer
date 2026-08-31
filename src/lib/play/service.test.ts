import fs from "node:fs/promises";
import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { addEntry } from "@/lib/journal/service";
import {
  MAX_QUEUE,
  dequeue,
  deleteSession,
  enqueue,
  finishSession,
  listOpenSessions,
  loadQueue,
  logPastSession,
  pastSessionSchema,
  playStateFor,
  reopenSession,
  reorderQueue,
  sessionsFor,
  startSession,
  startSessionSchema,
  updateSession,
} from "./service";

let nes: string;
let snes: string;
beforeEach(async () => {
  await prisma.journalEntry.deleteMany();
  await prisma.queueEntry.deleteMany();
  await prisma.playSession.deleteMany();
  await prisma.ownedGame.deleteMany();
  nes = (await prisma.ownedGame.create({ data: { title: "Contra", normalizedTitle: "contra", platform: "nes" } })).id;
  snes = (await prisma.ownedGame.create({ data: { title: "Contra III", normalizedTitle: "contra iii", platform: "snes" } })).id;
});

const status = async (fn: () => Promise<unknown>) => {
  try {
    await fn();
    return 0;
  } catch (e) {
    return (e as { status: number }).status;
  }
};

const at = (s: string) => new Date(`${s}T12:00:00.000Z`);

describe("play sessions", () => {
  it("cannot hold two open runs for one copy even against a raw insert", async () => {
    // The service check is a courtesy; this index is the guarantee. Written by
    // hand in its own migration because Prisma cannot express a partial index,
    // which is exactly the kind of DDL a `db push` test database would miss —
    // src/test/global-setup.ts runs `migrate deploy` for this reason.
    const idx = await prisma.$queryRawUnsafe<{ name: string }[]>(`select name from sqlite_master where type = 'index' and name = 'PlaySession_one_open_run'`);
    expect(idx).toHaveLength(1);

    await startSession(nes);
    await expect(
      prisma.$executeRawUnsafe(`insert into PlaySession (id, ownedGameId, startedAt, outcome, createdAt, updatedAt) values ('raw', '${nes}', 0, 'playing', 0, 0)`),
    ).rejects.toThrow(/UNIQUE constraint/i);
    expect(await prisma.playSession.count({ where: { ownedGameId: nes, endedAt: null } })).toBe(1);
  });

  it("lets only one of two simultaneous starts win", async () => {
    // The double-tap: two requests in flight before either has committed. One
    // gets a session, the other gets the same 409 the sequential path returns.
    const results = await Promise.allSettled([startSession(nes), startSession(nes)]);
    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected") as PromiseRejectedResult[];
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0].reason.status).toBe(409);
    expect(await prisma.playSession.count({ where: { ownedGameId: nes } })).toBe(1);
  });

  it("starts a run and refuses a second one on the same copy", async () => {
    const run = await startSession(nes, { note: "first go" });
    expect(run.endedAt).toBeNull();
    expect(run.outcome).toBe("playing");
    expect(await status(() => startSession(nes))).toBe(409);
    // A different copy of a different game is its own run.
    expect((await startSession(snes)).ownedGameId).toBe(snes);
    expect(await status(() => startSession("nope"))).toBe(404);
  });

  it("records three runs of the same copy, newest first", async () => {
    await logPastSession(nes, { startedAt: at("2019-01-01"), endedAt: at("2019-02-01") });
    await logPastSession(nes, { startedAt: at("2022-01-01"), endedAt: at("2022-03-01"), outcome: "abandoned" });
    await startSession(nes, { startedAt: at("2026-08-01") });
    const runs = await sessionsFor(nes);
    expect(runs).toHaveLength(3);
    expect(runs.map((r) => r.startedAt.getUTCFullYear())).toEqual([2026, 2022, 2019]);
    expect(runs.map((r) => r.outcome)).toEqual(["playing", "abandoned", "completed"]);
    // logPastSession never opens a run, so the copy can still be started later.
    expect(runs.filter((r) => r.endedAt === null)).toHaveLength(1);
  });

  it("takes a bare date as the local calendar day", async () => {
    const run = await startSession(nes, { startedAt: startSessionSchema.parse({ startedAt: "2026-08-30" }).startedAt });
    expect(run.startedAt.getDate()).toBe(30);
    expect(run.startedAt.getMonth()).toBe(7);
    expect(run.startedAt.getHours()).toBe(0);
  });

  it("400s when a run would end before it started", async () => {
    const run = await startSession(nes, { startedAt: at("2026-08-10") });
    expect(await status(() => finishSession(run.id, { outcome: "completed", endedAt: at("2026-08-01") }))).toBe(400);
    expect(await status(() => logPastSession(nes, { startedAt: at("2020-05-05"), endedAt: at("2020-05-01") }))).toBe(400);
    expect(await status(() => updateSession(run.id, { endedAt: at("2026-08-01") }))).toBe(400);
    expect(await status(() => finishSession("nope", { outcome: "completed" }))).toBe(404);
  });

  it("finishes, reopens, and keeps outcome consistent with endedAt", async () => {
    const run = await startSession(nes, { startedAt: at("2026-08-01") });
    const done = await finishSession(run.id, { outcome: "completed", endedAt: at("2026-08-20") });
    expect(done.endedAt).toEqual(at("2026-08-20"));
    expect(done.outcome).toBe("completed");

    const open = await reopenSession(run.id);
    expect(open.endedAt).toBeNull();
    expect(open.outcome).toBe("playing");
    // While it is open again, another run of the same copy is still a 409.
    expect(await status(() => startSession(nes))).toBe(409);

    // Closing via PATCH without saying how it went means it was finished.
    const closed = await updateSession(run.id, { endedAt: at("2026-08-21") });
    expect(closed.outcome).toBe("completed");
    // And a closed run cannot claim to be "playing".
    expect(await status(() => updateSession(run.id, { outcome: "playing" }))).toBe(400);
  });

  it("refuses to reopen a run when another one is already open", async () => {
    const old = await logPastSession(nes, { startedAt: at("2019-01-01"), endedAt: at("2019-02-01") });
    await startSession(nes, { startedAt: at("2026-08-01") });
    expect(await status(() => reopenSession(old.id))).toBe(409);
    expect(await status(() => updateSession(old.id, { endedAt: null }))).toBe(409);
  });

  it("leaves journal entries behind with a null sessionId when a run is deleted", async () => {
    const run = await startSession(nes);
    const entry = await addEntry(nes, { kind: "note", body: "stuck on the waterfall", sessionId: run.id });
    expect(entry.sessionId).toBe(run.id);
    await deleteSession(run.id);
    const after = await prisma.journalEntry.findUniqueOrThrow({ where: { id: entry.id } });
    expect(after.sessionId).toBeNull();
    expect(after.body).toBe("stuck on the waterfall");
    expect(await status(() => deleteSession(run.id))).toBe(404);
  });

  it("logs a run whose dates nobody remembers, closed and out of the way", async () => {
    // The whole point: this is a finished run, so it must never leave an open
    // one behind — `endedAt is null` still means "playing now" and nothing
    // else. The timestamps it carries are the moment it was recorded.
    const before = new Date();
    const run = await logPastSession(nes, { undated: true, note: "some time in the nineties" });
    expect(run.undated).toBe(true);
    expect(run.outcome).toBe("completed");
    expect(run.endedAt).not.toBeNull();
    expect(run.startedAt).toEqual(run.endedAt);
    expect(run.startedAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
    expect(await prisma.playSession.count({ where: { ownedGameId: nes, endedAt: null } })).toBe(0);
    // And the copy can still be started now, because nothing is open.
    expect((await startSession(nes)).endedAt).toBeNull();
  });

  it("refuses a run that is both undated and dated", async () => {
    expect(pastSessionSchema.safeParse({ undated: true, startedAt: at("2019-01-01"), endedAt: at("2019-02-01") }).success).toBe(false);
    // Half a date range is not a run either.
    expect(pastSessionSchema.safeParse({ startedAt: at("2019-01-01") }).success).toBe(false);
    expect(pastSessionSchema.safeParse({ undated: true, outcome: "abandoned" }).success).toBe(true);
  });

  it("sorts undated runs after every dated one", async () => {
    await logPastSession(nes, { startedAt: at("2019-01-01"), endedAt: at("2019-02-01") });
    const forgotten = await logPastSession(nes, { undated: true });
    await logPastSession(nes, { startedAt: at("2022-01-01"), endedAt: at("2022-03-01") });
    const runs = await sessionsFor(nes);
    // Recorded most recently of the three, but its dates are placeholders, so
    // it belongs at the bottom rather than at the top.
    expect(runs.map((r) => r.id).indexOf(forgotten.id)).toBe(2);
    expect(runs.slice(0, 2).map((r) => r.startedAt.getUTCFullYear())).toEqual([2022, 2019]);
  });

  it("fills the dates in later, and refuses to clear the flag without them", async () => {
    const run = await logPastSession(nes, { undated: true });
    // "I remembered when that was" — the dates have to come with it, because
    // the stored ones are the day it was typed in.
    expect(await status(() => updateSession(run.id, { undated: false }))).toBe(400);
    expect(await status(() => updateSession(run.id, { undated: false, startedAt: at("1994-06-01") }))).toBe(400);

    const dated = await updateSession(run.id, { undated: false, startedAt: at("1994-06-01"), endedAt: at("1994-08-01"), outcome: "abandoned" });
    expect(dated.undated).toBe(false);
    expect(dated.startedAt).toEqual(at("1994-06-01"));
    expect(dated.endedAt).toEqual(at("1994-08-01"));
    expect(dated.outcome).toBe("abandoned");
    // And now it sorts with the dated runs and counts towards lastPlayedAt.
    expect((await playStateFor([nes])).get(nes)!.lastPlayedAt).toEqual(at("1994-08-01"));
  });

  it("forgets the dates of a run that had them, and never leaves it open", async () => {
    const open = await startSession(nes, { startedAt: at("2026-08-01") });
    const forgotten = await updateSession(open.id, { undated: true });
    expect(forgotten.undated).toBe(true);
    expect(forgotten.endedAt).not.toBeNull();
    expect(forgotten.outcome).toBe("completed");
    expect(await prisma.playSession.count({ where: { ownedGameId: nes, endedAt: null } })).toBe(0);
  });

  it("never lets an undated run be open", async () => {
    const run = await logPastSession(nes, { undated: true });
    expect(await status(() => updateSession(run.id, { endedAt: null }))).toBe(400);
    expect(await status(() => updateSession(run.id, { undated: true, endedAt: null }))).toBe(400);
    expect(await status(() => reopenSession(run.id))).toBe(400);
    // Dates on an undated run without clearing the flag is the same mistake.
    expect(await status(() => updateSession(run.id, { startedAt: at("1994-06-01") }))).toBe(400);
    expect(await prisma.playSession.count({ where: { ownedGameId: nes, endedAt: null } })).toBe(0);
  });

  it("deletes an undated run and leaves its journal entries behind", async () => {
    const run = await logPastSession(nes, { undated: true });
    const entry = await addEntry(nes, { kind: "note", body: "borrowed it from my cousin", sessionId: run.id });
    await deleteSession(run.id);
    const after = await prisma.journalEntry.findUniqueOrThrow({ where: { id: entry.id } });
    expect(after.sessionId).toBeNull();
    expect(after.body).toBe("borrowed it from my cousin");
    expect(await prisma.playSession.count({ where: { ownedGameId: nes } })).toBe(0);
  });

  it("cascades sessions away when the owned game goes", async () => {
    await startSession(nes);
    await prisma.ownedGame.delete({ where: { id: nes } });
    expect(await prisma.playSession.count({ where: { ownedGameId: nes } })).toBe(0);
  });

  it("lists open runs newest first", async () => {
    await logPastSession(nes, { startedAt: at("2019-01-01"), endedAt: at("2019-02-01") });
    await startSession(nes, { startedAt: at("2026-08-01") });
    await startSession(snes, { startedAt: at("2026-08-10") });
    const open = await listOpenSessions();
    expect(open.map((s) => s.ownedGame.title)).toEqual(["Contra III", "Contra"]);
  });
});

describe("playStateFor", () => {
  it("returns never, played and playing in one query", async () => {
    await logPastSession(snes, { startedAt: at("2019-01-01"), endedAt: at("2019-02-01") });
    await logPastSession(snes, { startedAt: at("2022-01-01"), endedAt: at("2022-03-01") });
    const open = await startSession(nes, { startedAt: at("2026-08-01") });

    const states = await playStateFor([nes, snes, "no-such-id"]);
    expect(states.get(nes)).toEqual({ status: "playing", runs: 1, lastPlayedAt: at("2026-08-01"), openSessionId: open.id });
    expect(states.get(snes)).toEqual({ status: "played", runs: 2, lastPlayedAt: at("2022-03-01"), openSessionId: null });
    // Unknown ids are simply absent, and a game with no rows is "never".
    expect(states.get("no-such-id")).toEqual({ status: "never", runs: 0, lastPlayedAt: null, openSessionId: null });
    expect(await playStateFor([])).toEqual(new Map());
  });

  it("counts an undated run as played, with nothing to say about when", async () => {
    // An undated run's timestamps are the day it was typed in, so letting them
    // reach lastPlayedAt would report a game you last touched in 1994 as
    // played this afternoon. Played is true; when is genuinely not known.
    await logPastSession(nes, { undated: true });
    expect((await playStateFor([nes])).get(nes)).toEqual({ status: "played", runs: 1, lastPlayedAt: null, openSessionId: null });

    // Mixed: only the dated run can say when.
    await logPastSession(snes, { undated: true });
    await logPastSession(snes, { startedAt: at("2019-01-01"), endedAt: at("2019-02-01") });
    expect((await playStateFor([snes])).get(snes)).toEqual({ status: "played", runs: 2, lastPlayedAt: at("2019-02-01"), openSessionId: null });
  });

  it("says playing even when the copy also has finished runs", async () => {
    await logPastSession(nes, { startedAt: at("2019-01-01"), endedAt: at("2019-02-01") });
    await startSession(nes, { startedAt: at("2026-08-01") });
    const s = (await playStateFor([nes])).get(nes)!;
    expect(s.status).toBe("playing");
    expect(s.runs).toBe(2);
  });
});

describe("play queue", () => {
  it("appends with dense positions and moves an entry that is already queued", async () => {
    const third = (await prisma.ownedGame.create({ data: { title: "Gradius", normalizedTitle: "gradius", platform: "nes" } })).id;
    await enqueue(nes);
    await enqueue(snes);
    await enqueue(third, { note: "borrowed" });
    expect((await loadQueue()).map((e) => [e.ownedGame.title, e.position])).toEqual([
      ["Contra", 0],
      ["Contra III", 1],
      ["Gradius", 2],
    ]);

    // Re-queueing moves rather than duplicating, and keeps positions dense.
    await enqueue(third, { position: 0 });
    expect((await loadQueue()).map((e) => [e.ownedGame.title, e.position])).toEqual([
      ["Gradius", 0],
      ["Contra", 1],
      ["Contra III", 2],
    ]);
    expect(await prisma.queueEntry.count()).toBe(3);

    // Moving further down the list lands where you asked, not one short.
    await enqueue(third, { position: 2 });
    expect((await loadQueue()).map((e) => e.ownedGame.title)).toEqual(["Contra", "Contra III", "Gradius"]);
  });

  it("400s when the copy already has a run in progress", async () => {
    await startSession(nes);
    expect(await status(() => enqueue(nes))).toBe(400);
    expect(await status(() => enqueue("nope"))).toBe(404);
  });

  it("removes a game from the queue in the same transaction that starts its run", async () => {
    await enqueue(nes);
    await enqueue(snes);
    expect(await prisma.queueEntry.count()).toBe(2);

    await startSession(nes);
    const left = await loadQueue();
    expect(left.map((e) => e.ownedGameId)).toEqual([snes]);
    // And the survivor was renumbered back to a dense 0.
    expect(left[0].position).toBe(0);

    // The session create, the open-run check that guards it and the dequeue
    // must be one transaction, not follow-up writes: a crash between them
    // leaves a game both "up next" and "in progress", and a check made outside
    // the transaction lets a double-tap through. Asserted on the source
    // because that is exactly the property an innocent refactor breaks.
    const src = await fs.readFile(new URL("./service.ts", import.meta.url), "utf8");
    const body = src.slice(src.indexOf("export async function startSession"), src.indexOf("/** Close an open run."));
    const tx = body.indexOf("$transaction");
    expect(tx).toBeGreaterThan(-1);
    for (const inside of ["assertNoOpenRun(tx,", "tx.playSession.create", "tx.queueEntry.deleteMany"]) {
      expect(body.indexOf(inside), inside).toBeGreaterThan(tx);
    }
  });

  it("dequeues and renumbers, 404s on a game that was never queued", async () => {
    await enqueue(nes);
    await enqueue(snes);
    await dequeue(nes);
    expect((await loadQueue()).map((e) => [e.ownedGameId, e.position])).toEqual([[snes, 0]]);
    expect(await status(() => dequeue(nes))).toBe(404);
  });

  it("reorders in one transaction and 400s on anything that is not a permutation", async () => {
    await enqueue(nes);
    await enqueue(snes);
    const reordered = await reorderQueue([snes, nes]);
    expect(reordered.map((e) => [e.ownedGameId, e.position])).toEqual([
      [snes, 0],
      [nes, 1],
    ]);

    expect(await status(() => reorderQueue([snes]))).toBe(400); // dropped one
    expect(await status(() => reorderQueue([snes, nes, "extra"]))).toBe(400); // added one
    expect(await status(() => reorderQueue([snes, snes]))).toBe(400); // listed twice
    // The failed attempts left the order alone.
    expect((await loadQueue()).map((e) => e.ownedGameId)).toEqual([snes, nes]);
  });

  it("cascades a queue entry away when the owned game is deleted", async () => {
    await enqueue(nes);
    await prisma.ownedGame.delete({ where: { id: nes } });
    expect(await prisma.queueEntry.count()).toBe(0);
  });

  it("refuses to grow past MAX_QUEUE but still lets a queued game move", async () => {
    const ids: string[] = [];
    for (let i = 0; i < MAX_QUEUE; i++) {
      const g = await prisma.ownedGame.create({ data: { title: `Game ${i}`, normalizedTitle: `game ${i}`, platform: "nes" } });
      ids.push(g.id);
      await enqueue(g.id);
    }
    expect(await status(() => enqueue(nes))).toBe(409);
    // Not a hard freeze: an entry already in the queue can still be moved.
    await enqueue(ids[MAX_QUEUE - 1], { position: 0 });
    expect((await loadQueue())[0].ownedGameId).toBe(ids[MAX_QUEUE - 1]);
  });
});
