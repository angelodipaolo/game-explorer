/**
 * Export the collection to data/snapshot.json so it ships with the repo.
 * Skips import-session scaffolding except committed batches (needed for undo).
 */
import fs from "node:fs";
import path from "node:path";
import { prisma } from "../src/lib/db";

async function main() {
  const out = {
    version: 1,
    exportedAt: new Date().toISOString(),
    catalogGames: await prisma.catalogGame.findMany({ orderBy: { igdbId: "asc" } }),
    importSessions: await prisma.importSession.findMany({ where: { status: "committed" } }),
    importRows: await prisma.importRow.findMany({ where: { session: { status: "committed" } }, orderBy: [{ sessionId: "asc" }, { index: "asc" }] }),
    importBatches: await prisma.importBatch.findMany(),
    ownedGames: await prisma.ownedGame.findMany({ orderBy: { title: "asc" } }),
    importEffects: await prisma.importEffect.findMany(),
    gameFacts: await prisma.gameFact.findMany(),
    gameTags: await prisma.gameTag.findMany(),
    gameCodes: await prisma.gameCode.findMany(),
    gameMaps: await prisma.gameMap.findMany(),
    mapMarkers: await prisma.mapMarker.findMany(),
    gameBookmarks: await prisma.gameBookmark.findMany(),
    gameManuals: await prisma.gameManual.findMany(),
    manualPages: await prisma.manualPage.findMany(),
    musicTracks: await prisma.musicTrack.findMany(),
    playSessions: await prisma.playSession.findMany(),
    journalEntries: await prisma.journalEntry.findMany(),
    queueEntries: await prisma.queueEntry.findMany(),
    series: await prisma.series.findMany(),
    seriesEntries: await prisma.seriesEntry.findMany(),
    enrichmentRuns: await prisma.enrichmentRun.findMany(),
  };
  const file = path.resolve(__dirname, "../data/snapshot.json");
  fs.writeFileSync(file, JSON.stringify(out, null, 1));
  console.log(`wrote ${file}: ${out.ownedGames.length} owned, ${out.catalogGames.length} catalog, ${out.gameFacts.length} facts, ${out.gameTags.length} tags, ${out.gameCodes.length} codes, ${out.gameMaps.length} maps (${out.mapMarkers.length} markers — images stay in data/maps/), ${out.gameBookmarks.length} bookmarks, ${out.gameManuals.length} manuals (${out.manualPages.length} pages — scans stay in data/manuals/), ${out.musicTracks.length} music tracks (audio stays in data/music/), ${out.playSessions.length} play sessions, ${out.journalEntries.length} journal entries (photos stay in data/journal/), ${out.queueEntries.length} queued, ${out.series.length} series (${out.seriesEntries.length} entries)`);
}

main().finally(() => prisma.$disconnect());
