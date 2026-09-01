/**
 * Rebuild the database from data/snapshot.json. Run `prisma migrate deploy`
 * first (npm run db:restore does both). Existing rows are replaced.
 *
 * A new table has to be added here *and* to scripts/db-snapshot.ts by hand.
 * Order matters twice over: rows are deleted children-first and inserted
 * parents-first, because SQLite checks the foreign keys as it goes.
 */
import fs from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { prisma } from "../src/lib/db";

/**
 * A snapshot as it comes back off disk.
 *
 * The element type is deliberately opaque (`never[]` is the one array type
 * assignable to every `createMany` input): the Prisma model types do *not*
 * describe this object, because JSON has no Date — every timestamp arrives as
 * an ISO string, which `createMany` accepts and the model types do not.
 */
type SnapshotFile = Record<string, never[]>;

/**
 * Replace everything in `db` with the contents of `snap`, in one transaction.
 *
 * Exported (rather than inlined into `main`) so the GAMEEXPLOR-0034 round-trip
 * regression test can restore a snapshot it just built into a real database
 * and check that the rows survive — the failure it guards against was one this
 * function raised, on a snapshot that looked perfectly fine on disk.
 */
export async function restoreSnapshot(db: PrismaClient, snap: SnapshotFile) {
  await db.$transaction(async (tx) => {
    await tx.importEffect.deleteMany();
    await tx.mapMarker.deleteMany();
    await tx.gameMap.deleteMany();
    await tx.musicTrack.deleteMany();
    await tx.manualPage.deleteMany();
    await tx.gameManual.deleteMany();
    await tx.gameBookmark.deleteMany();
    await tx.gameCode.deleteMany();
    await tx.gameTag.deleteMany();
    await tx.gameFact.deleteMany();
    await tx.seriesEntry.deleteMany();
    await tx.series.deleteMany();
    await tx.queueEntry.deleteMany();
    await tx.journalEntry.deleteMany();
    await tx.playSession.deleteMany();
    await tx.ownedGame.deleteMany();
    await tx.importBatch.deleteMany();
    await tx.importRow.deleteMany();
    await tx.importSession.deleteMany();
    await tx.catalogGame.deleteMany();
    await tx.enrichmentRun.deleteMany();
    await tx.catalogGame.createMany({ data: snap.catalogGames });
    await tx.importSession.createMany({ data: snap.importSessions });
    await tx.importRow.createMany({ data: snap.importRows });
    await tx.importBatch.createMany({ data: snap.importBatches });
    await tx.ownedGame.createMany({ data: snap.ownedGames });
    await tx.importEffect.createMany({ data: snap.importEffects });
    await tx.gameFact.createMany({ data: snap.gameFacts });
    await tx.gameTag.createMany({ data: snap.gameTags ?? [] });
    await tx.gameCode.createMany({ data: snap.gameCodes ?? [] });
    await tx.gameMap.createMany({ data: snap.gameMaps ?? [] });
    await tx.mapMarker.createMany({ data: snap.mapMarkers ?? [] });
    await tx.gameBookmark.createMany({ data: snap.gameBookmarks ?? [] });
    // Manuals before the pages that point at them.
    await tx.gameManual.createMany({ data: snap.gameManuals ?? [] });
    await tx.manualPage.createMany({ data: snap.manualPages ?? [] });
    await tx.musicTrack.createMany({ data: snap.musicTracks ?? [] });
    // Sessions before the entries that point at them; the queue last.
    await tx.playSession.createMany({ data: snap.playSessions ?? [] });
    await tx.journalEntry.createMany({ data: snap.journalEntries ?? [] });
    await tx.queueEntry.createMany({ data: snap.queueEntries ?? [] });
    // Series before the entries that point at them.
    await tx.series.createMany({ data: snap.series ?? [] });
    await tx.seriesEntry.createMany({ data: snap.seriesEntries ?? [] });
    await tx.enrichmentRun.createMany({ data: snap.enrichmentRuns ?? [] });
  });
}

async function main() {
  const file = path.resolve(__dirname, "../data/snapshot.json");
  const snap = JSON.parse(fs.readFileSync(file, "utf8"));
  await restoreSnapshot(prisma, snap);
  console.log(`restored ${snap.ownedGames.length} owned games, ${snap.catalogGames.length} catalog rows, ${(snap.playSessions ?? []).length} play sessions, ${(snap.journalEntries ?? []).length} journal entries, ${(snap.queueEntries ?? []).length} queued, ${(snap.gameBookmarks ?? []).length} bookmarks, ${(snap.manualPages ?? []).length} manual pages, ${(snap.musicTracks ?? []).length} music tracks, ${(snap.series ?? []).length} series (${(snap.seriesEntries ?? []).length} entries), ${(snap.importSessions ?? []).length} import sessions (${(snap.importBatches ?? []).length} batches) from ${snap.exportedAt}`);
}

// Only when run as a script: the tests import restoreSnapshot directly.
if (require.main === module) {
  main()
    .catch((e) => {
      // The whole error, stack included. Every way a restore fails here is a
      // surprise — a foreign key the export should have caught, a bad path, a
      // Prisma fault — and a surprise is worth a stack.
      console.error(e);
      process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
}
