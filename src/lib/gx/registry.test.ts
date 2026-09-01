import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { COMMANDS, GROUPS, type Command } from "./registry";

/**
 * The registry has to be *true*, not just well-typed.
 *
 * TypeScript proves a command has a `route` and a `method`; it cannot prove
 * that the route is a route or that the verb is one the route exports. That
 * gap is exactly where the old prose drifted, so it is checked here against
 * the filesystem.
 *
 * This is the "my data is honest" direction — every command names a real
 * route+method. GAMEEXPLOR-0030 owns the other direction: every route an agent
 * may drive has a command. Both are needed, and this one belongs with the
 * registry because it fails the moment a route file moves under someone's
 * feet, which is the day you want to hear about it.
 */

const ROOT = path.resolve(__dirname, "../../..");
const API = path.join(ROOT, "src/app/api");

/** Every route file, as the literal path a registry entry spells: `/api/games/[id]/codes`. */
function routeFiles(dir: string, prefix = "/api"): Map<string, string> {
  const found = new Map<string, string>();
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) for (const [k, v] of routeFiles(full, `${prefix}/${entry.name}`)) found.set(k, v);
    else if (entry.name === "route.ts") found.set(prefix, full);
  }
  return found;
}

/**
 * The verbs a route file exports. Matches `const` as well as `function` — Next
 * accepts `export const GET = …` too, and a verb this regex cannot see is a
 * verb neither this test nor `src/lib/skills/coverage.test.ts` can hold anyone
 * to. The two files carry the same regex on purpose; if you touch one, touch
 * both.
 */
function methodsOf(file: string): Set<string> {
  const source = fs.readFileSync(file, "utf8");
  const found = new Set<string>();
  for (const m of source.matchAll(/^export\s+(?:async\s+function\s+|function\s+|const\s+)(GET|POST|PUT|PATCH|DELETE)\b/gm)) found.add(m[1]);
  return found;
}

const ROUTES = routeFiles(API);

describe("the command registry", () => {
  it("every command's route exists under src/app/api", () => {
    const missing = COMMANDS.filter((c) => !ROUTES.has(c.route)).map((c) => `gx ${c.group} ${c.name} -> ${c.route}`);
    expect(missing).toEqual([]);
  });

  it("every command's method is one the route actually exports", () => {
    const wrong: string[] = [];
    for (const c of COMMANDS) {
      const file = ROUTES.get(c.route);
      if (!file) continue;
      if (!methodsOf(file).has(c.method)) wrong.push(`gx ${c.group} ${c.name} -> ${c.method} ${c.route}`);
    }
    expect(wrong).toEqual([]);
  });

  it("every [param] in a route is filled by one of the command's arguments", () => {
    // The failure this prevents is a 404 on a literal `[id]` — a request that
    // looks like it worked right up until the response.
    const unfilled: string[] = [];
    for (const c of COMMANDS) {
      const params = [...c.route.matchAll(/\[([^\]]+)\]/g)].map((m) => m[1]);
      const filled = c.args.filter((a) => a.into.kind === "path").map((a) => (a.into as { param: string }).param);
      for (const p of params) if (!filled.includes(p)) unfilled.push(`gx ${c.group} ${c.name} has no argument for [${p}]`);
    }
    expect(unfilled).toEqual([]);
  });

  it("group + name is unique, and every command's group is declared", () => {
    const keys = COMMANDS.map((c) => `${c.group} ${c.name}`);
    expect(keys.length).toBe(new Set(keys).size);
    const declared = new Set(GROUPS.map((g) => g.name));
    expect(COMMANDS.filter((c) => !declared.has(c.group)).map((c) => c.group)).toEqual([]);
    // And no group with no commands: an empty heading in `gx --help` is a lie
    // about what the tool can do.
    expect(GROUPS.filter((g) => !COMMANDS.some((c) => c.group === g.name)).map((g) => g.name)).toEqual([]);
  });

  it("flags are kebab-case, unique per command, and never shadow a global flag", () => {
    const problems: string[] = [];
    for (const c of COMMANDS) {
      const names = c.flags.map((f) => f.name);
      if (names.length !== new Set(names).size) problems.push(`gx ${c.group} ${c.name} has a duplicate flag`);
      for (const n of names) {
        if (!/^[a-z][a-z0-9-]*$/.test(n)) problems.push(`--${n} on gx ${c.group} ${c.name} is not kebab-case`);
        if (["json", "raw", "dev", "help"].includes(n)) problems.push(`--${n} on gx ${c.group} ${c.name} shadows a global flag`);
      }
      // At most one whole-body flag: two would make "which one wins" a thing
      // someone has to remember.
      expect(c.flags.filter((f) => f.into.kind === "body-json").length).toBeLessThanOrEqual(1);
    }
    expect(problems).toEqual([]);
  });

  it("a GET never declares a body, and only a write takes a file", () => {
    const problems: string[] = [];
    for (const c of COMMANDS) {
      const takesBody = [...c.args, ...c.flags].some((x) => x.into.kind === "body" || x.into.kind === "body-json");
      if (c.method === "GET" && takesBody) problems.push(`gx ${c.group} ${c.name} is a GET with a body`);
      const takesFile = c.args.some((a) => a.into.kind === "file");
      if (takesFile && c.method === "GET") problems.push(`gx ${c.group} ${c.name} is a GET that uploads a file`);
      if (takesFile && !c.contentType) problems.push(`gx ${c.group} ${c.name} uploads a file with no content type`);
    }
    expect(problems).toEqual([]);
  });

  it("summaries are written, not stubbed", () => {
    // Cheap, and it has caught a copy-pasted entry more than once in this
    // codebase's other tables: the help text *is* the documentation, so an
    // eight-character summary is a missing one.
    const thin = COMMANDS.filter((c: Command) => c.summary.trim().length < 20).map((c) => `${c.group} ${c.name}`);
    expect(thin).toEqual([]);
    expect(GROUPS.filter((g) => g.summary.trim().length < 20).map((g) => g.name)).toEqual([]);
  });

  it("no command drives a route an agent must not touch", () => {
    // Auth is the owner's browser session and /api/img is the shelf's pixels:
    // neither is collection data, so neither is a gap in coverage. The journal
    // is the one actual refusal — the owner's own writing about their own
    // life, and the "Never write these" section of the curate-collection skill
    // says so in as many words.
    //
    // The play log and the queue were on this list until GAMEEXPLOR-0031 and
    // are deliberately off it now: "record, never infer" is a rule about where
    // a run's *facts* come from, and no test can check that. What a test can
    // check is that the journal never grows a command by accident, which is
    // what this is for. Do not add /api/sessions or /api/queue back.
    const banned = [/^\/api\/auth\//, /^\/api\/img\//, /^\/api\/journal\//, /^\/api\/games\/\[id\]\/journal$/];
    const offenders = COMMANDS.filter((c) => banned.some((b) => b.test(c.route))).map((c) => `${c.group} ${c.name} -> ${c.route}`);
    expect(offenders).toEqual([]);
  });
});
