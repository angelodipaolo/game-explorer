/**
 * Human-readable output (GAMEEXPLOR-0036).
 *
 * `--json` is the contract an agent should pipe; this is what a person — or an
 * agent reading its own transcript — sees by default. It is deliberately one
 * generic renderer rather than a formatter per command: sixty hand-written
 * printers would be sixty more things to drift from the API's response shapes,
 * which is the failure this whole ticket exists to remove. So this file knows
 * about *shapes* (an array of flat records, an object with one list in it, the
 * `{ written, skipped }` result every batch endpoint returns) and nothing at
 * all about games, codes or series.
 *
 * The rule it follows: never hide a field. Long values are truncated with an
 * ellipsis and wide tables drop columns past the eighth — but the count of
 * dropped columns is printed, and `--json` is one flag away. Silently omitting
 * a `skipped` array would be the one bug that matters here, because "the API
 * refused half of that batch" is exactly what the caller has to notice.
 */

const MAX_COLUMNS = 8;
const MAX_CELL = 44;

/** A value that fits in a table cell — everything else forces the block layout. */
function isScalar(v: unknown): boolean {
  return v === null || typeof v === "string" || typeof v === "number" || typeof v === "boolean";
}

function cell(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "string") return v.length > MAX_CELL ? `${v.slice(0, MAX_CELL - 1)}…` : v;
  return String(v);
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Column order: first-seen across every row, so the API's own field order survives. */
function columnsOf(rows: Record<string, unknown>[]): string[] {
  const seen: string[] = [];
  for (const row of rows) for (const key of Object.keys(row)) if (!seen.includes(key)) seen.push(key);
  return seen;
}

/** An array of flat records as a padded table. Returns null when the rows are not flat. */
function table(rows: unknown[], indent: string): string[] | null {
  if (!rows.every(isPlainObject)) return null;
  const records = rows as Record<string, unknown>[];
  if (!records.every((r) => Object.values(r).every(isScalar))) return null;

  const all = columnsOf(records);
  const cols = all.slice(0, MAX_COLUMNS);
  const widths = cols.map((c) => Math.max(c.length, ...records.map((r) => cell(r[c]).length)));
  const line = (values: string[]) => indent + values.map((v, i) => v.padEnd(widths[i])).join("  ").trimEnd();

  const out = [line(cols), indent + cols.map((_, i) => "─".repeat(widths[i])).join("  ")];
  for (const r of records) out.push(line(cols.map((c) => cell(r[c]))));
  if (all.length > cols.length) out.push(`${indent}(+${all.length - cols.length} more columns — use --json)`);
  return out;
}

function renderArray(value: unknown[], indent: string): string[] {
  if (!value.length) return [`${indent}(none)`];
  if (value.every(isScalar)) return [indent + value.map(cell).join(", ")];
  const asTable = table(value, indent);
  if (asTable) return asTable;
  // Nested objects: one indented block per item, numbered so a reader can say
  // "the third one" about a batch result.
  const out: string[] = [];
  value.forEach((item, i) => {
    out.push(`${indent}[${i}]`);
    out.push(...renderValue(item, `${indent}  `));
  });
  return out;
}

function renderObject(value: Record<string, unknown>, indent: string): string[] {
  const entries = Object.entries(value);
  // An empty object is a real answer — "this run wrote nothing, by field" —
  // and printing a blank line for it reads as a rendering bug.
  if (!entries.length) return [`${indent}(empty)`];
  // Key order is the API's, not ours. `{ games, nextCursor }` reads as the
  // rows and then the cursor; `{ total, gaps }` reads as the count and then
  // the work — both because the route wrote them that way. Hoisting the
  // scalars to the top would put "nextCursor: —" above the search results.
  const scalarWidth = Math.max(0, ...entries.filter(([, v]) => isScalar(v)).map(([k]) => k.length));

  const out: string[] = [];
  for (const [k, v] of entries) {
    if (isScalar(v)) {
      out.push(`${indent}${`${k}:`.padEnd(scalarWidth + 1)} ${cell(v)}`);
      continue;
    }
    // The count in the heading is what makes a `skipped: []` visible at a
    // glance next to a `written: [12 rows]`.
    const count = Array.isArray(v) ? ` (${v.length})` : "";
    if (out.length) out.push("");
    out.push(`${indent}${k}${count}:`);
    out.push(...renderValue(v, `${indent}  `));
  }
  return out;
}

function renderValue(value: unknown, indent: string): string[] {
  if (value === undefined) return [`${indent}(no body)`];
  if (Array.isArray(value)) return renderArray(value, indent);
  if (isPlainObject(value)) return renderObject(value, indent);
  return [indent + cell(value)];
}

/** The whole response, as text with a trailing newline. */
export function render(value: unknown): string {
  const lines = renderValue(value, "");
  return `${lines.join("\n")}\n`;
}

/**
 * What a binary read prints when `--raw` was not passed: enough to tell whether
 * an upload landed whole, and not a megabyte of JPEG in the scrollback.
 */
export function renderBytes(contentType: string | null, bytes: Uint8Array): string {
  return `${contentType ?? "application/octet-stream"}, ${bytes.byteLength.toLocaleString("en-US")} bytes\n(pass --raw to write the bytes to stdout)\n`;
}
