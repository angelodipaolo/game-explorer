/**
 * Reads Angelo's collection out of a COPY of game-manage's SQLite file.
 * Never points at the original: the copy is made by the caller.
 */
import { execFileSync } from "node:child_process";
import { normalizeTitle } from "../../src/lib/catalog/normalize";
import { resolvePlatform } from "../../src/lib/platforms";

export type SourceRow = {
  id: string;
  itemType: string;
  title: string;
  platform: string | null;
  completeness: string | null;
  conditionGrade: string | null;
  quantity: number;
  notes: string | null;
  catalogSource: string | null;
  catalogGameId: string | null;
};

/** Known non-game residue in the source data. Normalized titles. */
export const JUNK_TITLES = new Set(
  ["Import Test A", "Import Test B", "Row 118", "Row 119", "Advantage Controller", "DualShock 2 Controller", "Top Loading Nintendo  Console"].map(normalizeTitle),
);

export function readSourceRows(dbPath: string): SourceRow[] {
  const sql =
    "select id, itemType, title, platform, completeness, conditionGrade, quantity, notes, catalogSource, catalogGameId from InventoryItem order by createdAt, id";
  const out = execFileSync("sqlite3", ["-readonly", "-json", dbPath, sql], { encoding: "utf8" });
  return out.trim() ? (JSON.parse(out) as SourceRow[]) : [];
}

export type CollapsedTitle = {
  title: string;
  normalizedTitle: string;
  platform: string | null;
  /** Number of source rows that collapsed into this title. */
  copies: number;
  completeness: string | null;
  condition: string | null;
  notes: string | null;
  sourceIds: string[];
};

/**
 * 618 rows → ~178 titles. Repeated CSV test imports duplicated rows, so a
 * collapsed row's `copies` is how many source rows shared the title, which is
 * the best available proxy for physical copies.
 */
export function collapseTitles(rows: SourceRow[]): { games: CollapsedTitle[]; dropped: SourceRow[] } {
  const dropped: SourceRow[] = [];
  const byKey = new Map<string, CollapsedTitle>();
  for (const row of rows) {
    const normalizedTitle = normalizeTitle(row.title);
    if (row.itemType !== "game" || JUNK_TITLES.has(normalizedTitle)) {
      dropped.push(row);
      continue;
    }
    const key = `${normalizedTitle}|${(row.platform ?? "").toLowerCase()}`;
    const existing = byKey.get(key);
    if (existing) {
      existing.copies += 1;
      existing.sourceIds.push(row.id);
      existing.completeness ??= row.completeness;
      existing.condition ??= row.conditionGrade;
      existing.notes ??= row.notes;
    } else {
      byKey.set(key, {
        title: row.title.trim().replace(/\s+/g, " "),
        normalizedTitle,
        platform: row.platform,
        copies: 1,
        completeness: row.completeness,
        condition: row.conditionGrade,
        notes: row.notes,
        sourceIds: [row.id],
      });
    }
  }
  return { games: [...byKey.values()], dropped };
}

/**
 * `Joe and Mac Super Nintendo` → { title: "Joe and Mac", platform: "Super Nintendo" }.
 * Only strips when the trailing words are a known platform alias.
 */
export function splitPlatformSuffix(title: string): { title: string; platform: string | null } {
  const words = title.trim().split(/\s+/);
  for (let n = Math.min(4, words.length - 1); n >= 1; n--) {
    const tail = words.slice(-n).join(" ");
    const p = resolvePlatform(tail);
    if (p) return { title: words.slice(0, -n).join(" "), platform: tail };
  }
  return { title, platform: null };
}
