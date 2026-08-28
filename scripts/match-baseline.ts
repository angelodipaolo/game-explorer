/**
 * Matcher baseline against the real collection. Measures match rate and
 * player-data coverage under two game_type policies:
 *   strict — game_type = 0 (Main Game) only
 *   ports  — game_type = (0, 11), i.e. also Port
 *
 * Run: npx tsx scripts/match-baseline.ts <path-to-copy-of-game-manage.db> <out.json>
 */
import "dotenv/config";
import fs from "node:fs";
import { igdbApi, MAIN_GAME_TYPE, CARTRIDGE_GAME_TYPES } from "../src/lib/igdb";
import { decide, findCandidates, type MatchCandidate } from "../src/lib/catalog/match";
import { resolvePlatform } from "../src/lib/platforms";
import { collapseTitles, readSourceRows } from "./lib/source-collection";

async function main() {
  const [dbPath, outPath] = process.argv.slice(2);
  if (!dbPath || !outPath) throw new Error("usage: match-baseline <db> <out.json>");
  const api = igdbApi();
  const { games, dropped } = collapseTitles(readSourceRows(dbPath));
  console.log(`${games.length} titles, ${dropped.length} rows dropped`);

  const report: Record<string, unknown>[] = [];
  const policies = { strict: [MAIN_GAME_TYPE], ports: CARTRIDGE_GAME_TYPES };
  const tally: Record<string, { auto: number; held: number; none: number }> = { strict: { auto: 0, held: 0, none: 0 }, ports: { auto: 0, held: 0, none: 0 } };

  for (const g of games) {
    const platform = resolvePlatform(g.platform) ?? resolvePlatform("nes")!;
    const row: Record<string, unknown> = { title: g.title, platform: platform.slug, copies: g.copies };
    for (const [name, types] of Object.entries(policies)) {
      const cands = await findCandidates(g.title, [platform.igdbId], (term, p) => api.search(term, p, 10, types));
      const verdict = decide(cands);
      const top: MatchCandidate | undefined = cands[0];
      row[name] = { verdict: verdict.kind, top: top ? `${top.name} (${top.confidence})` : null, reason: top?.reason ?? null };
      if (verdict.kind === "auto") tally[name].auto++;
      else if (verdict.kind === "no-match") tally[name].none++;
      else tally[name].held++;
    }
    console.log(g.title.padEnd(40), JSON.stringify(row.strict), "|", JSON.stringify(row.ports));
    report.push(row);
  }
  const summary = { titles: games.length, dropped: dropped.map((d) => d.title), tally };
  fs.writeFileSync(outPath, JSON.stringify({ summary, rows: report }, null, 2));
  console.log(JSON.stringify(tally, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
