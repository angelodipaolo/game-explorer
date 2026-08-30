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
    await tx.gameCode.deleteMany();
    await tx.gameTag.deleteMany();
    await tx.gameFact.deleteMany();
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
    await tx.enrichmentRun.createMany({ data: snap.enrichmentRuns ?? [] });
  });
  console.log(`restored ${snap.ownedGames.length} owned games, ${snap.catalogGames.length} catalog rows from ${snap.exportedAt}`);
}

main().finally(() => prisma.$disconnect());
