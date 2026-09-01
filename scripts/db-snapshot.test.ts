import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { CatalogPort, MatchCandidate } from "@/lib/catalog";
import { prisma } from "@/lib/db";
import { commitSession, createSession, rollbackBatch } from "@/lib/import/service";
import { buildSnapshot } from "./db-snapshot";
import { restoreSnapshot } from "./db-restore";

/**
 * The GAMEEXPLOR-0034 round trip.
 *
 * The bug was never visible in a fixture: it took a *real* rollback to produce
 * the state that broke the export, because the state is made by
 * `rollbackBatch` marking the batch `rolled_back` and reopening its session in
 * the same transaction. So this test builds the database the way the owner
 * does — import, commit, undo — snapshots it through the real exporter, writes
 * the JSON to disk, and restores it through the real restorer. Nothing here is
 * hand-assembled; if any of the three ever disagree again, this fails.
 */

function cand(igdbId: number, name: string, confidence: number): MatchCandidate {
  return { igdbId, name, slug: name.toLowerCase(), confidence, gameType: 0, parentId: null, onPlatform: true, via: name, coverImageId: null, firstReleaseYear: 1990, platformNames: ["NES"], reason: "test", };
}

/** Two NES games, matched confidently, with no network anywhere near it. */
function fakeCatalog(): CatalogPort {
  const table: Record<string, MatchCandidate[]> = {
    contra: [cand(1, "Contra", 1), cand(2, "Contra Force", 0.7)],
    "duck tales": [cand(6, "Disney's DuckTales", 0.95), cand(7, "DuckTales 2", 0.6)],
  };
  return {
    async candidates(title) {
      return table[title.toLowerCase()] ?? [];
    },
    async collection() {
      return null;
    },
    async collectionsForGame() {
      return [];
    },
    async proposeMembers(): Promise<never> {
      throw new Error("not used by the import path");
    },
    async sync(ids) {
      for (const id of ids) {
        await prisma.catalogGame.upsert({ where: { igdbId: id }, create: { igdbId: id, name: `Game ${id}`, slug: `game-${id}`, detail: "full" }, update: {} });
      }
      return { full: ids.length, stubs: 0, requests: 1, fetched: ids };
    },
  };
}

async function wipe() {
  await prisma.importEffect.deleteMany();
  await prisma.importBatch.deleteMany();
  await prisma.importRow.deleteMany();
  await prisma.importSession.deleteMany();
  await prisma.ownedGame.deleteMany();
  await prisma.catalogGame.deleteMany();
}

beforeEach(wipe);
// The restore replaces every table, so leave the shared test database empty
// rather than handing the next test file this file's collection.
afterAll(wipe);

/** Import one game, commit it, and hand back the batch. */
async function importAndCommit(label: string, title: string) {
  const session = await createSession({ label, source: "agent", defaultPlatform: "nes", rows: [{ title, quantity: 1 }] }, { catalog: fakeCatalog() });
  const { batchId } = await commitSession(session.id, {}, { catalog: fakeCatalog() });
  return { sessionId: session.id, batchId };
}

/** Snapshot to a real file and restore from it, exactly as the two scripts do. */
async function roundTrip() {
  const snapshot = await buildSnapshot(prisma);
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "game-explorer-snapshot-")), "snapshot.json");
  fs.writeFileSync(file, JSON.stringify(snapshot, null, 1));
  try {
    // Through JSON, so every Date is the ISO string the restore really sees.
    await restoreSnapshot(prisma, JSON.parse(fs.readFileSync(file, "utf8")));
    return snapshot;
  } finally {
    fs.rmSync(path.dirname(file), { recursive: true, force: true });
  }
}

describe("snapshot round trip after a rollback", () => {
  it("leaves an open session owning a batch — the state the bug was made of", async () => {
    const kept = await importAndCommit("kept", "Contra");
    const undone = await importAndCommit("undone", "Duck Tales");
    await rollbackBatch(undone.batchId);

    // This is the ticket's real cause, asserted rather than assumed: undoing an
    // import is what puts an `open` session and a batch in the database at the
    // same time, and any owner who has ever used undo has one.
    expect(await prisma.importSession.findUnique({ where: { id: undone.sessionId } })).toMatchObject({ status: "open" });
    expect(await prisma.importBatch.findUnique({ where: { id: undone.batchId } })).toMatchObject({ status: "rolled_back", sessionId: undone.sessionId });
    expect(await prisma.importSession.findUnique({ where: { id: kept.sessionId } })).toMatchObject({ status: "committed" });
  });

  it("exports and restores it whole: the reopened session, its rows, its batch, and the games the other import kept", async () => {
    const kept = await importAndCommit("kept", "Contra");
    const undone = await importAndCommit("undone", "Duck Tales");
    await rollbackBatch(undone.batchId);

    const snapshot = await roundTrip();

    // The reopened session is in the export because a batch points at it — the
    // old rule ("committed only") dropped it and the restore died on the FK.
    expect(snapshot.importSessions.map((s) => s.id).sort()).toEqual([kept.sessionId, undone.sessionId].sort());
    // …and it is not a hollow shell: its rows came with it.
    expect(snapshot.importRows.filter((r) => r.sessionId === undone.sessionId)).toHaveLength(1);

    expect(await prisma.importSession.findUnique({ where: { id: undone.sessionId } })).toMatchObject({ label: "undone", status: "open" });
    expect(await prisma.importBatch.findUnique({ where: { id: undone.batchId } })).toMatchObject({ status: "rolled_back", sessionId: undone.sessionId });
    expect(await prisma.importRow.count({ where: { sessionId: undone.sessionId } })).toBe(1);

    // The undo removed DuckTales; Contra and its provenance survive the trip.
    const games = await prisma.ownedGame.findMany();
    expect(games.map((g) => g.title)).toEqual(["Contra"]);
    expect(games[0].importBatchId).toBe(kept.batchId);
    expect(await prisma.importEffect.count({ where: { batchId: kept.batchId } })).toBe(1);
  });

  it("still leaves out scaffolding nothing points at: an open session with no batch", async () => {
    await importAndCommit("kept", "Contra");
    const abandoned = await createSession({ label: "abandoned", source: "agent", defaultPlatform: "nes", rows: [{ title: "Duck Tales", quantity: 1 }] }, { catalog: fakeCatalog() });

    const snapshot = await roundTrip();

    expect(snapshot.importSessions.map((s) => s.id)).not.toContain(abandoned.id);
    expect(snapshot.importRows.some((r) => r.sessionId === abandoned.id)).toBe(false);
    expect(await prisma.importSession.findUnique({ where: { id: abandoned.id } })).toBeNull();
  });
});
