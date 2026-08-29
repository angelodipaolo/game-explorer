/**
 * Import a collection from a COPY of a game-manage dev.db,
 * through the import API (never a private write path).
 *
 *   cp /path/to/game-manage/apps/web/prisma/dev.db scratch/game-manage.db
 *   npx tsx scripts/import-collection.ts scratch/game-manage.db http://localhost:3000 [report.md]
 *
 * Creates one session, submits rows in batches of 25, then prints a report of
 * everything held for review and every title IGDB places on another platform.
 * It does NOT commit — review the session at /import/<id> first.
 */
import fs from "node:fs";
import { collapseTitles, readSourceRows, splitPlatformSuffix } from "./lib/source-collection";

type Row = { id: string; title: string; platform: string; quantity: number; decision: string; holdReason: string | null; candidates: string; chosenIgdbId: number | null; chosenConfidence: number | null };
type Candidate = { igdbId: number; name: string; confidence: number; reason: string; onPlatform: boolean; platformNames: string[]; firstReleaseYear: number | null };

async function api<T>(base: string, path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(base + path, { headers: { "content-type": "application/json" }, ...init });
  const json = (await res.json()) as T & { error?: string };
  if (!res.ok) throw new Error(`${path}: ${res.status} ${json.error ?? ""}`);
  return json;
}

async function main() {
  const [dbPath, base = "http://localhost:3001", reportPath] = process.argv.slice(2);
  if (!dbPath) throw new Error("usage: import-collection <db copy> [base url] [report.md]");
  const source = readSourceRows(dbPath);
  const { games, dropped } = collapseTitles(source);
  console.log(`${source.length} source rows → ${games.length} titles; ${dropped.length} rows dropped`);

  const inputs = games.map((g) => {
    const split = g.platform ? { title: g.title, platform: g.platform } : splitPlatformSuffix(g.title);
    return {
      title: split.title,
      platform: split.platform,
      quantity: g.copies,
      completeness: g.completeness,
      condition: g.condition,
      notes: g.notes,
    };
  });

  const session = await api<{ id: string }>(base, "/api/import/sessions", {
    method: "POST",
    body: JSON.stringify({ label: `game-manage migration ${new Date().toISOString().slice(0, 10)}`, source: "migration", rows: [] }),
  });
  console.log("session", session.id);

  const BATCH = 25;
  for (let i = 0; i < inputs.length; i += BATCH) {
    const rows = inputs.slice(i, i + BATCH);
    const t = Date.now();
    await api(base, `/api/import/sessions/${session.id}/rows`, { method: "POST", body: JSON.stringify({ rows, defaultPlatform: "NES" }) });
    console.log(`  rows ${i + 1}–${i + rows.length} in ${((Date.now() - t) / 1000).toFixed(1)}s`);
  }

  const full = await api<{ rows: Row[] }>(base, `/api/import/sessions/${session.id}`);
  const rows = full.rows;
  const auto = rows.filter((r) => r.decision === "auto");
  const held = rows.filter((r) => r.decision === "review");
  const merged = rows.filter((r) => r.decision === "merge");
  const offPlatform = rows.filter((r) => {
    const c = (JSON.parse(r.candidates) as Candidate[])[0];
    return c && !c.onPlatform && c.confidence >= 0.8;
  });

  const lines: string[] = [];
  lines.push(`# Collection import report — ${new Date().toISOString()}`, "");
  lines.push(`Session \`${session.id}\` at ${base}/import/${session.id}`, "");
  lines.push(`| | count |`, `| --- | --- |`, `| Source rows | ${source.length} |`, `| Dropped (non-games / test residue) | ${dropped.length} |`, `| Titles submitted | ${rows.length} |`, `| Matched automatically | ${auto.length} (${Math.round((100 * auto.length) / rows.length)}%) |`, `| Held for review | ${held.length} |`, `| In-session merges | ${merged.length} |`, "");
  lines.push("## Dropped rows", "", ...dropped.map((d) => `- ${d.title} (${d.itemType})`), "");
  lines.push("## Not an NES release according to IGDB", "");
  for (const r of offPlatform) {
    const c = (JSON.parse(r.candidates) as Candidate[])[0];
    lines.push(`- **${r.title}** (submitted as ${r.platform}) → ${c.name}: ${c.platformNames.join(", ")}`);
  }
  lines.push("", "## Held for review", "");
  for (const r of held) {
    const cands = (JSON.parse(r.candidates) as Candidate[]).slice(0, 3);
    lines.push(`- **${r.title}** [${r.platform}] ×${r.quantity} — ${r.holdReason}`);
    for (const c of cands) lines.push(`  - ${c.igdbId} ${c.name}${c.firstReleaseYear ? ` (${c.firstReleaseYear})` : ""} · ${Math.round(c.confidence * 100)}% · ${c.reason}`);
  }
  lines.push("", "## Auto-matched", "");
  for (const r of auto) {
    const c = (JSON.parse(r.candidates) as Candidate[]).find((x) => x.igdbId === r.chosenIgdbId);
    lines.push(`- ${r.title} [${r.platform}]${r.quantity > 1 ? ` ×${r.quantity}` : ""} → ${c?.name ?? r.chosenIgdbId} (${Math.round((r.chosenConfidence ?? 0) * 100)}%)`);
  }
  const report = lines.join("\n");
  if (reportPath) fs.writeFileSync(reportPath, report);
  console.log(report.split("\n").slice(0, 60).join("\n"));
  console.log(`\nReview at ${base}/import/${session.id}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
