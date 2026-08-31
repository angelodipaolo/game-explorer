/**
 * Rebuild the database from data/snapshot.json. Run `prisma migrate deploy`
 * first (npm run db:restore does both). Existing rows are replaced.
 */
import fs from "node:fs";
import path from "node:path";
import { prisma } from "../src/lib/db";

async function main() {
  const file = path.resolve(__dirname, "../data/snapshot.json");
  const snap = JSON.parse(fs.readFileSync(file, "utf8"));
  await prisma.$transaction(async (tx) => {
    await tx.importEffect.deleteMany();
    await tx.mapMarker.deleteMany();
    await tx.gameMap.deleteMany();
    await tx.gameCode.deleteMany();
    await tx.gameTag.deleteMany();
    await tx.gameFact.deleteMany();
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
    // Sessions before the entries that point at them; the queue last.
    await tx.playSession.createMany({ data: snap.playSessions ?? [] });
    await tx.journalEntry.createMany({ data: snap.journalEntries ?? [] });
    await tx.queueEntry.createMany({ data: snap.queueEntries ?? [] });
    await tx.enrichmentRun.createMany({ data: snap.enrichmentRuns ?? [] });
  });
  console.log(`restored ${snap.ownedGames.length} owned games, ${snap.catalogGames.length} catalog rows, ${(snap.playSessions ?? []).length} play sessions, ${(snap.journalEntries ?? []).length} journal entries, ${(snap.queueEntries ?? []).length} queued from ${snap.exportedAt}`);
}

main().finally(() => prisma.$disconnect());
