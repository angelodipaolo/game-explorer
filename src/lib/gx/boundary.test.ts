import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Architectural seam: **the CLI never opens a database** (GAMEEXPLOR-0036).
 *
 * Modelled on `src/lib/igdb/boundary.test.ts`, and here for a sharper reason
 * than tidiness. The failure this whole ticket exists to prevent is an agent
 * writing to the disposable `prisma/dev.db` in a checkout and reporting
 * success — which is exactly what a `gx` command that imported `@/lib/db`
 * would do, quietly, for whichever collection the checkout happened to hold.
 * `env.ts` can refuse a localhost *URL*; it cannot refuse a Prisma client
 * someone imported three modules deep.
 *
 * So this walks the **transitive** import graph from `scripts/gx.ts` and every
 * file under `src/lib/gx/`, and fails if any module in that closure imports a
 * database or a Next server runtime. Checking only the direct imports would
 * pass a CLI that imported `@/lib/codes/service`, which imports `@/lib/db`,
 * which opens the file.
 *
 * The rule is "no database", not "no imports": `src/lib/platforms.ts`,
 * `src/lib/facts.ts` and the three `kinds.ts` files are pure data and the
 * registry imports them on purpose, so `gx codes add --help` lists the same
 * four kinds the API validates against instead of a second copy that can rot.
 */

const ROOT = path.resolve(__dirname, "../../..");

/** Nothing in the CLI's import closure may name any of these. */
const FORBIDDEN = [
  { pattern: /["']@prisma\/client["']/, why: "the Prisma client opens the database file" },
  { pattern: /["']\.prisma\/client["']/, why: "the generated Prisma client opens the database file" },
  { pattern: /["']@\/lib\/db["']/, why: "@/lib/db is the shared PrismaClient" },
  { pattern: /["']next\/server["']/, why: "next/server is the request runtime, and the CLI is not a route" },
  { pattern: /["']next["']/, why: "the CLI must run under plain tsx, with no Next runtime" },
];

/** The entry points. Everything reachable from these is in scope. */
const ENTRY_POINTS = [path.join(ROOT, "scripts/gx.ts"), ...fs.readdirSync(path.join(ROOT, "src/lib/gx")).map((f) => path.join(ROOT, "src/lib/gx", f))];

/** Every `from "…"` in a file, in source order. */
function importsOf(source: string): string[] {
  const found: string[] = [];
  const re = /(?:from|import)\s*\(?\s*["']([^"']+)["']/g;
  for (let m = re.exec(source); m; m = re.exec(source)) found.push(m[1]);
  return found;
}

/**
 * Resolve a specifier the way the bundler does: `@/x` is `src/x`, a relative
 * path is relative to the importer, and a bare package name is external (and
 * therefore not walked — a dependency's own imports are not our seam, and the
 * FORBIDDEN list catches the packages that matter by name).
 */
function resolve(specifier: string, fromFile: string): string | null {
  let base: string;
  if (specifier.startsWith("@/")) base = path.join(ROOT, "src", specifier.slice(2));
  else if (specifier.startsWith(".")) base = path.resolve(path.dirname(fromFile), specifier);
  else return null;

  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, path.join(base, "index.ts"), path.join(base, "index.tsx")]) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
  }
  return null;
}

describe("gx boundary", () => {
  it("nothing the CLI can reach imports Prisma, @/lib/db or a Next runtime", () => {
    const seen = new Set<string>();
    const queue = [...ENTRY_POINTS.filter((f) => /\.ts$/.test(f) && !f.endsWith(".test.ts"))];
    const offenders: string[] = [];

    while (queue.length) {
      const file = queue.pop()!;
      if (seen.has(file)) continue;
      seen.add(file);

      const source = fs.readFileSync(file, "utf8");
      const rel = path.relative(ROOT, file);
      for (const { pattern, why } of FORBIDDEN) {
        if (pattern.test(source)) offenders.push(`${rel} imports ${pattern.source} — ${why}`);
      }
      for (const specifier of importsOf(source)) {
        const resolved = resolve(specifier, file);
        if (resolved) queue.push(resolved);
      }
    }

    expect(offenders).toEqual([]);
    // A guard on the guard: if the closure ever collapses to just the entry
    // points, the walk stopped resolving and the assertion above is vacuous.
    expect(seen.size).toBeGreaterThanOrEqual(ENTRY_POINTS.length);
  });

  it("the CLI reads no file except the one an upload names", () => {
    // `node:fs` is legal in exactly one module, for exactly one reason: an
    // owner-named map scan, manual page or MP3 being streamed to the API.
    // Anywhere else it is the beginning of a config file, a cached token, or a
    // database — none of which this CLI has or should grow.
    const usesFs: string[] = [];
    for (const file of ENTRY_POINTS.filter((f) => /\.ts$/.test(f) && !f.endsWith(".test.ts"))) {
      const source = fs.readFileSync(file, "utf8");
      if (/["']node:fs(\/promises)?["']/.test(source)) usesFs.push(path.basename(file));
    }
    expect(usesFs.sort()).toEqual(["client.ts"]);
  });
});
