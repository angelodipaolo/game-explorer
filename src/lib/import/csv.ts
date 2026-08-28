/**
 * Browser CSV drop: parse, guess columns from headers, produce rows for the
 * import API. No mapping step — the heuristics are the mapping. If the
 * title column cannot be found the drop is rejected with the headers seen.
 */
import type { ImportRowInput } from "./schema";

const HEADER_ALIASES: Record<keyof ImportRowInput, string[]> = {
  title: ["title", "name", "game", "game title", "item", "product"],
  platform: ["platform", "system", "console", "format"],
  quantity: ["quantity", "qty", "count", "copies", "owned"],
  completeness: ["completeness", "complete", "contents", "cib"],
  condition: ["condition", "grade", "condition grade"],
  notes: ["notes", "note", "comment", "comments", "description"],
  igdbId: ["igdb", "igdb id", "igdbid", "igdb_id"],
};

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  const src = text.replace(/^﻿/, "");
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      rows.push(row);
      row = [];
    } else field += ch;
  }
  if (field.length || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

export type ColumnMap = Partial<Record<keyof ImportRowInput, number>>;

export function guessColumns(headers: string[]): ColumnMap {
  const map: ColumnMap = {};
  const norm = headers.map((h) => h.trim().toLowerCase().replace(/[_-]+/g, " "));
  for (const [field, aliases] of Object.entries(HEADER_ALIASES) as [keyof ImportRowInput, string[]][]) {
    const idx = norm.findIndex((h) => aliases.includes(h));
    if (idx >= 0) map[field] = idx;
  }
  return map;
}

export type CsvResult = { rows: ImportRowInput[]; columns: ColumnMap; headers: string[]; skipped: number };

export function csvToRows(text: string): CsvResult {
  const table = parseCsv(text);
  if (!table.length) throw new Error("CSV is empty");
  const headers = table[0];
  const columns = guessColumns(headers);
  if (columns.title == null) {
    throw new Error(`Could not find a title column. Headers seen: ${headers.join(", ")}. Name one "title", "name" or "game".`);
  }
  const rows: ImportRowInput[] = [];
  let skipped = 0;
  const cell = (r: string[], i: number | undefined) => (i == null ? null : (r[i]?.trim() ?? "") || null);
  for (const r of table.slice(1)) {
    const title = cell(r, columns.title);
    if (!title) {
      skipped++;
      continue;
    }
    const qty = cell(r, columns.quantity);
    const igdb = cell(r, columns.igdbId);
    rows.push({
      title,
      platform: cell(r, columns.platform),
      quantity: qty && /^\d+$/.test(qty) ? Math.max(1, Number(qty)) : 1,
      completeness: cell(r, columns.completeness),
      condition: cell(r, columns.condition),
      notes: cell(r, columns.notes),
      igdbId: igdb && /^\d+$/.test(igdb) ? Number(igdb) : null,
    });
  }
  return { rows, columns, headers, skipped };
}
