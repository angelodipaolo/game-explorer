import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Architectural seam: only the catalog module and scripts may import the
 * IGDB client. The app reads local tables only.
 */
const ROOT = path.resolve(__dirname, "../../..");
const ALLOWED_PREFIXES = ["src/lib/igdb/", "src/lib/catalog/", "scripts/"];

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.(ts|tsx|mts|js|mjs)$/.test(entry.name)) out.push(full);
  }
  return out;
}

describe("IGDB boundary", () => {
  it("nothing outside src/lib/igdb, src/lib/catalog and scripts imports the IGDB client", () => {
    const files = [...walk(path.join(ROOT, "src")), ...(fs.existsSync(path.join(ROOT, "scripts")) ? walk(path.join(ROOT, "scripts")) : [])];
    const offenders: string[] = [];
    for (const file of files) {
      const rel = path.relative(ROOT, file);
      if (ALLOWED_PREFIXES.some((p) => rel.startsWith(p))) continue;
      const src = fs.readFileSync(file, "utf8");
      if (/from\s+["'](@\/lib\/igdb|\.{1,2}\/(?:.*\/)?igdb)(\/[^"']*)?["']/.test(src)) offenders.push(rel);
    }
    expect(offenders).toEqual([]);
  });
});
