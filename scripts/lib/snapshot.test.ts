import { describe, expect, it } from "vitest";
import {
  UnrestorableSnapshotError,
  assertRestorable,
  findDanglingReferences,
  isExportedSession,
  selectImportRows,
  selectImportSessions,
} from "./snapshot";

const session = (id: string, status: string) => ({ id, status });
const batch = (id: string, sessionId: string) => ({ id, sessionId });

describe("selectImportSessions", () => {
  it("keeps committed sessions and any session a batch points at, and drops the rest", () => {
    const sessions = [
      session("committed", "committed"),
      // The GAMEEXPLOR-0034 case: rollbackBatch reopens the session it undid,
      // so an open session owning a rolled-back batch is the ordinary outcome
      // of the undo feature — not stray scaffolding.
      session("reopened-by-rollback", "open"),
      session("half-finished", "open"),
      session("abandoned", "discarded"),
    ];
    const batches = [batch("b1", "committed"), batch("b2", "reopened-by-rollback")];
    expect(selectImportSessions(sessions, batches).map((s) => s.id)).toEqual(["committed", "reopened-by-rollback"]);
  });

  it("keeps a discarded session that still owns a batch — the batch is what matters, not the status", () => {
    expect(isExportedSession({ status: "discarded" }, true)).toBe(true);
    expect(isExportedSession({ status: "discarded" }, false)).toBe(false);
    expect(isExportedSession({ status: "committed" }, false)).toBe(true);
  });
});

describe("selectImportRows", () => {
  it("exports exactly the rows of the exported sessions, so no session restores as a hollow shell", () => {
    const rows = [
      { id: "r1", sessionId: "committed" },
      { id: "r2", sessionId: "reopened-by-rollback" },
      { id: "r3", sessionId: "half-finished" },
    ];
    const kept = selectImportRows(rows, [session("committed", "committed"), session("reopened-by-rollback", "open")]);
    expect(kept.map((r) => r.id)).toEqual(["r1", "r2"]);
  });
});

/** A minimal but self-consistent snapshot: one import, one game, one fact. */
function validSnapshot() {
  return {
    version: 1,
    exportedAt: "2026-09-01T00:00:00.000Z",
    catalogGames: [{ igdbId: 1234 }],
    importSessions: [{ id: "s1", status: "committed" }],
    importRows: [{ id: "r1", sessionId: "s1" }],
    importBatches: [{ id: "b1", sessionId: "s1" }],
    ownedGames: [{ id: "g1", importBatchId: "b1", catalogGameId: 1234 }],
    importEffects: [{ id: "e1", batchId: "b1", ownedGameId: "g1" }],
    gameFacts: [{ id: "f1", ownedGameId: "g1" }],
    gameTags: [{ id: "tg1", ownedGameId: "g1" }],
    gameCodes: [{ id: "c1", ownedGameId: "g1" }],
    gameBookmarks: [{ id: "bm1", ownedGameId: "g1" }],
    gameMaps: [{ id: "m1", ownedGameId: "g1" }],
    mapMarkers: [{ id: "mm1", mapId: "m1" }],
    gameManuals: [{ id: "man1", ownedGameId: "g1" }],
    manualPages: [{ id: "p1", manualId: "man1" }],
    musicTracks: [{ id: "t1", ownedGameId: "g1" }],
    playSessions: [{ id: "ps1", ownedGameId: "g1" }],
    // Both shapes of journal entry: one written during a run, one outside one.
    journalEntries: [
      { id: "j1", ownedGameId: "g1", sessionId: "ps1" },
      { id: "j2", ownedGameId: "g1", sessionId: null },
    ],
    queueEntries: [{ id: "q1", ownedGameId: "g1" }],
    series: [{ id: "se1" }],
    seriesEntries: [{ id: "sen1", seriesId: "se1", igdbId: 999 }],
  };
}

describe("findDanglingReferences", () => {
  it("passes a self-consistent snapshot, nulls and all", () => {
    expect(findDanglingReferences(validSnapshot())).toEqual([]);
    expect(() => assertRestorable(validSnapshot())).not.toThrow();
  });

  it("catches the bug this was written for: a batch whose session was filtered out", () => {
    const snap = { ...validSnapshot(), importSessions: [] };
    expect(findDanglingReferences(snap)).toContainEqual({
      table: "importBatches",
      field: "sessionId",
      rowId: "b1",
      parentTable: "importSessions",
      missingId: "s1",
    });
  });

  it("names the table, the row and the missing parent in the failure message", () => {
    const snap = { ...validSnapshot(), importBatches: [] };
    let caught: unknown;
    try {
      assertRestorable(snap);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(UnrestorableSnapshotError);
    const message = (caught as Error).message;
    expect(message).toContain("ownedGames g1: importBatchId=b1 is not in importBatches");
    expect(message).toContain("importEffects e1: batchId=b1 is not in importBatches");
    expect(message).toContain("nothing was written");
  });

  it("checks the per-copy children too — a map, a marker, a page, a track, a queue entry, a series entry", () => {
    const snap = {
      ...validSnapshot(),
      gameMaps: [],
      gameManuals: [],
      playSessions: [],
      series: [],
      ownedGames: [],
    };
    const found = findDanglingReferences(snap).map((d) => `${d.table}.${d.field}`);
    for (const expected of [
      "mapMarkers.mapId",
      "manualPages.manualId",
      "journalEntries.sessionId",
      "seriesEntries.seriesId",
      "gameFacts.ownedGameId",
      "gameTags.ownedGameId",
      "gameCodes.ownedGameId",
      "gameBookmarks.ownedGameId",
      "musicTracks.ownedGameId",
      "journalEntries.ownedGameId",
      "queueEntries.ownedGameId",
    ]) {
      expect(found).toContain(expected);
    }
  });

  it("treats a null foreign key as a fact, not a gap", () => {
    // A game added by hand has no import batch and no catalog match; a journal
    // entry written outside a run has no play session. None of those dangle.
    const snap = {
      ...validSnapshot(),
      importSessions: [],
      importRows: [],
      importBatches: [],
      importEffects: [],
      catalogGames: [],
      ownedGames: [{ id: "g1", importBatchId: null, catalogGameId: null }],
    };
    expect(findDanglingReferences(snap)).toEqual([]);
  });

  it("resolves an integer key as happily as a cuid", () => {
    const snap = { ...validSnapshot(), catalogGames: [{ igdbId: 4321 }] };
    expect(findDanglingReferences(snap)).toEqual([
      { table: "ownedGames", field: "catalogGameId", rowId: "g1", parentTable: "catalogGames", missingId: "1234" },
    ]);
  });
});
