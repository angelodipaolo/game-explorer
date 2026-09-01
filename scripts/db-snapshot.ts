/**
 * Export the collection to data/snapshot.json so it ships with the repo.
 *
 * Import scaffolding is mostly skipped — a session someone abandoned halfway
 * through review is throwaway — but a session that owns a batch is kept, with
 * its rows, because the batch is the unit of undo and `OwnedGame.importBatchId`
 * is the provenance of every game an import created. See
 * `scripts/lib/snapshot.ts` for why that rule is not simply "committed"
 * (GAMEEXPLOR-0034: every rollback reopens its session, so "committed only"
 * exported batches whose session had been filtered out, and the restore died on
 * the foreign key).
 *
 * A new table has to be added here *and* to scripts/db-restore.ts by hand —
 * both enumerate their tables, and a table missed here vanishes from every
 * future `npm run db:restore`.
 */
import fs from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { prisma } from "../src/lib/db";
import { UnrestorableSnapshotError, assertRestorable, selectImportRows, selectImportSessions } from "./lib/snapshot";

/**
 * Read the whole database into one plain object.
 *
 * Exported (rather than inlined into `main`) so the round-trip regression test
 * can snapshot and restore a real database without going near
 * `data/snapshot.json`.
 */
export async function buildSnapshot(db: PrismaClient = prisma) {
  // Sessions and rows are filtered in memory rather than by a `where` clause:
  // the rule spans two tables ("committed, or a batch points at it"), and the
  // one place it is written down is `selectImportSessions`, where it is unit
  // tested. A `where` clause here would be a second copy of it, free to drift.
  const importBatches = await db.importBatch.findMany();
  const importSessions = selectImportSessions(await db.importSession.findMany(), importBatches);
  const allRows = await db.importRow.findMany({ orderBy: [{ sessionId: "asc" }, { index: "asc" }] });

  const out = {
    version: 1,
    exportedAt: new Date().toISOString(),
    catalogGames: await db.catalogGame.findMany({ orderBy: { igdbId: "asc" } }),
    importSessions,
    importRows: selectImportRows(allRows, importSessions),
    importBatches,
    ownedGames: await db.ownedGame.findMany({ orderBy: { title: "asc" } }),
    importEffects: await db.importEffect.findMany(),
    gameFacts: await db.gameFact.findMany(),
    gameTags: await db.gameTag.findMany(),
    gameCodes: await db.gameCode.findMany(),
    gameMaps: await db.gameMap.findMany(),
    mapMarkers: await db.mapMarker.findMany(),
    gameBookmarks: await db.gameBookmark.findMany(),
    gameManuals: await db.gameManual.findMany(),
    manualPages: await db.manualPage.findMany(),
    musicTracks: await db.musicTrack.findMany(),
    playSessions: await db.playSession.findMany(),
    journalEntries: await db.journalEntry.findMany(),
    queueEntries: await db.queueEntry.findMany(),
    series: await db.series.findMany(),
    seriesEntries: await db.seriesEntry.findMany(),
    enrichmentRuns: await db.enrichmentRun.findMany(),
  };

  // Last gate before anything is written. Every foreign key in the export has
  // to resolve inside the export, because a restore is one `createMany` per
  // table in a single transaction: one row pointing at a parent that was
  // filtered out does not skip a row, it aborts the whole restore — usually on
  // another machine, long after the database that produced this file is gone.
  // Failing here is the difference between a bug you can see and a bug you
  // discover the day you need the backup.
  assertRestorable(out);
  return out;
}

async function main() {
  const out = await buildSnapshot();
  const file = path.resolve(__dirname, "../data/snapshot.json");
  fs.writeFileSync(file, JSON.stringify(out, null, 1));
  console.log(`wrote ${file}: ${out.ownedGames.length} owned, ${out.catalogGames.length} catalog, ${out.gameFacts.length} facts, ${out.gameTags.length} tags, ${out.gameCodes.length} codes, ${out.gameMaps.length} maps (${out.mapMarkers.length} markers — images stay in data/maps/), ${out.gameBookmarks.length} bookmarks, ${out.gameManuals.length} manuals (${out.manualPages.length} pages — scans stay in data/manuals/), ${out.musicTracks.length} music tracks (audio stays in data/music/), ${out.playSessions.length} play sessions, ${out.journalEntries.length} journal entries (photos stay in data/journal/), ${out.queueEntries.length} queued, ${out.series.length} series (${out.seriesEntries.length} entries), ${out.importSessions.length} import sessions (${out.importBatches.length} batches)`);
}

// Only when run as a script: the tests import buildSnapshot directly.
if (require.main === module) {
  main()
    .catch((e) => {
      // An UnrestorableSnapshotError has already said everything useful in its
      // message and a stack would only bury it. Anything else — a Prisma
      // failure, a bad path — is a surprise, and for a surprise the stack is
      // the most useful thing there is.
      console.error(e instanceof UnrestorableSnapshotError ? e.message : e);
      process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
}
