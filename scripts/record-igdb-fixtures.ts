/**
 * Records live IGDB search responses for the matcher regression tests.
 * Run: npx tsx scripts/record-igdb-fixtures.ts
 * Output: src/lib/catalog/__fixtures__/search.json  { [term|platforms]: hits[] }
 */
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { igdbApi } from "../src/lib/igdb";
import { titleVariants } from "../src/lib/catalog/normalize";

const TITLES = ["Super Mario Bros", "Gauntlet", "Duck Tales", "Star Tropics", "Duck Tales 2", "Star Tropics II: Zoda's Revenge", "Pac-Man [Tengen]", "Contra", "Legend of Zelda, The", "Roller Games"];

export function fixtureKey(term: string, platformIds?: number[]): string {
  return `${term}|${(platformIds ?? []).join(",")}`;
}

async function main() {
  const api = igdbApi();
  const out: Record<string, unknown> = {};
  for (const title of TITLES) {
    for (const term of titleVariants(title)) {
      const key = fixtureKey(term, [18]);
      if (out[key]) continue;
      out[key] = await api.search(term, [18]);
      console.log(key, (out[key] as unknown[]).length);
    }
  }
  const file = path.resolve(__dirname, "../src/lib/catalog/__fixtures__/search.json");
  fs.writeFileSync(file, JSON.stringify(out, null, 2));
  console.log("wrote", file);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
