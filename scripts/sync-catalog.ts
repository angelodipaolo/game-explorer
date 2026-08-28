/**
 * Refresh every linked catalog entry from IGDB (and stub its similar games).
 * Run after schema changes to the catalog, or just to pick up new data.
 *   npx tsx scripts/sync-catalog.ts
 */
import "dotenv/config";
import { syncCatalog } from "../src/lib/catalog";
import { prisma } from "../src/lib/db";

async function main() {
  const owned = await prisma.ownedGame.findMany({ where: { catalogGameId: { not: null } }, select: { catalogGameId: true } });
  const ids = owned.map((o) => o.catalogGameId!);
  const report = await syncCatalog(ids);
  console.log(`synced ${report.full} games, ${report.stubs} new stubs, ${report.requests} requests`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
