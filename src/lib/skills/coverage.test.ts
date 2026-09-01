import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { COMMANDS } from "@/lib/gx/registry";

/**
 * Skill coverage: **a route an agent may drive is a route an agent can find**
 * (GAMEEXPLOR-0030).
 *
 * This is the twin of `src/lib/igdb/boundary.test.ts`. That one keeps a module
 * boundary honest; this one keeps the *agent interface* honest, and it exists
 * because the interface was prose for a year and prose rotted exactly the way
 * prose does. Six skill files drifted from the routes they described, a shell
 * fallback nobody re-read sent a write at `localhost`, and a game was added to
 * a disposable dev database that the owner will never see. Every assertion
 * below is one of those failures, turned into something the build can catch.
 *
 * The shape of the check follows from GAMEEXPLOR-0036's decision to ship a CLI:
 *
 * 1. **Route → command.** Code against code, the strong one. Every `route.ts`
 *    under `src/app/api` is enumerated from the filesystem, its verbs read out
 *    of the source, and each `path+method` pair must either be driveable by a
 *    `gx` command or be on the allowlist below. Matching route paths against
 *    Markdown was the original plan; a registry that carries `route` and
 *    `method` as data made a real assertion possible instead.
 * 2. **Route → documentation.** Weaker on purpose: the path must be *mentioned*
 *    somewhere under `.claude/skills/curate-collection/`. Whether what is
 *    written there is true is a review problem. Whether anything is written at
 *    all is a test problem, and this is the test.
 * 3. **Mirror byte-identity, where a mirror is claimed.** `.agents/skills/` is
 *    Codex's copy of `.claude/skills/`; a shared skill is one document with two
 *    homes and they have already drifted once. `curate-collection` must be in
 *    both trees, any skill in both must match byte for byte, and a skill in
 *    only one tree is a deliberate single-client skill and passes. The long
 *    comment on that assertion explains why it is not a whole-tree walk.
 * 4. **No localhost fallback.** `${GAME_EXPLORER_URL:-http://localhost:3000}`
 *    is the specific line that caused the original incident. It must not exist
 *    in either tree, in any form.
 *
 * Plus one positive assertion: the journal routes must still be *named as
 * refused* in SKILL.md. An allowlist entry says "no command needed here"; only
 * the skill says "and here is why you must not". Deleting that section would
 * otherwise quietly convert a documented refusal into an undocumented gap —
 * which is the exact shape of the hole this whole ticket is about.
 *
 * ## What this file does not own
 *
 * The *inverse* direction — every `gx` command names a route that exists, with
 * a verb that route exports — is asserted in `src/lib/gx/registry.test.ts`,
 * next to the registry, where it fails on the day a route file moves. So is
 * "no command drives a banned route". That last list and the `ALLOWLIST` here
 * are the same set of routes read from opposite ends: there, no command may
 * *reach* them; here, they need no command. They were left as two lists
 * deliberately. Sharing one would mean either importing a test file from
 * another test file (which re-registers its suites) or lifting a test fixture
 * into `src/lib` as if it were production code. Two short lists that must move
 * together, each commented, next to the thing it protects, is the cheaper
 * trade — and if they ever disagree, assertion 5 below is what still fails.
 */

const ROOT = path.resolve(__dirname, "../../..");
const API_DIR = path.join(ROOT, "src/app/api");
const SKILL_DIR = path.join(ROOT, ".claude/skills/curate-collection");
const CLAUDE_SKILLS = path.join(ROOT, ".claude/skills");
const AGENT_SKILLS = path.join(ROOT, ".agents/skills");

/** The one skill both clients must ship. Everything else in either tree is that client's own business. */
const SHARED_SKILL = "curate-collection";

/**
 * Routes that need no `gx` command and no line in the skill.
 *
 * This list is short on purpose and each entry says why. "The agent has no
 * business here" is the only admissible reason — "nobody got round to
 * documenting it" is the failure, not an exemption. If you are adding a line
 * here to make a build green, you are almost certainly meant to be adding a
 * command or a paragraph instead.
 */
export const ALLOWLIST: { route: string; why: string }[] = [
  { route: "/api/auth/login", why: "the owner's browser session; an agent authenticates with a bearer token and never logs in" },
  { route: "/api/auth/logout", why: "the other half of the browser session; there is no agent session to end" },
  { route: "/api/img/[size]/[imageId]", why: "public read-only cache of IGDB art; pixels, not collection data, and nothing to curate" },
  { route: "/api/games/[id]/journal", why: "no agent write path by design (GAMEEXPLOR-0009) — the refusal is asserted positively below" },
  { route: "/api/journal/[entryId]", why: "same refusal: the owner's own writing about their own life is not dictatable" },
  { route: "/api/journal/[entryId]/image", why: "same refusal; the photo is part of the entry, not a separate capability" },
];

const ALLOWLISTED = new Set(ALLOWLIST.map((entry) => entry.route));

/**
 * The journal, spelled as SKILL.md's "Never write these" section spells it.
 * Bracket form, because that section quotes the literal Next paths.
 */
const REFUSED_IN_SKILL = ["/api/games/[id]/journal", "/api/journal/[entryId]", "/api/journal/[entryId]/image"];

/* --------------------------------------------------------------- the routes

   Read off the filesystem rather than a list, because a list is the thing that
   rots. A route exists the moment someone saves `route.ts`; it is in scope for
   this test at exactly that moment too. */

/** Every route file, keyed by the URL path its directory spells: `/api/games/[id]/codes`. */
function routeFiles(dir: string, prefix = "/api", found = new Map<string, string>()): Map<string, string> {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) routeFiles(full, `${prefix}/${entry.name}`, found);
    else if (entry.name === "route.ts") found.set(prefix, full);
  }
  return found;
}

/**
 * The verbs a route file exports. A regex, the way `boundary.test.ts` works:
 * parsing TypeScript to learn that a file exports `GET` would be a heavier
 * tool aimed at a smaller question, and Next only recognises these as
 * top-level named function exports anyway.
 */
function methodsOf(file: string): string[] {
  const source = fs.readFileSync(file, "utf8");
  return [...source.matchAll(/^export\s+(?:async\s+)?function\s+(GET|POST|PUT|PATCH|DELETE)\b/gm)].map((m) => m[1]);
}

const ROUTES = routeFiles(API_DIR);

/* ------------------------------------------------------------ the skill text

   All of it, concatenated, with the path each line came from kept so a failure
   can point at a file. */

function walkFiles(dir: string, base = dir, found: string[] = []): string[] {
  if (!fs.existsSync(dir)) return found;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walkFiles(full, base, found);
    else found.push(path.relative(base, full));
  }
  return found.sort();
}

/** The skills in a tree: its immediate subdirectories, each of which is one skill. */
function skillNames(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
    .map((entry) => entry.name)
    .sort();
}

const SKILL_TEXT = walkFiles(SKILL_DIR)
  .map((rel) => fs.readFileSync(path.join(SKILL_DIR, rel), "utf8"))
  .join("\n");

/**
 * Does the skill mention this route anywhere?
 *
 * The reference files write parameters the way a reader wants to see them —
 * `/api/games/:id/codes` in one file, `/api/games/<ownedGameId>/codes` in the
 * next — while the filesystem spells them `[id]`. Insisting on one spelling
 * would be a formatting rule dressed up as a coverage rule, so any
 * placeholder-shaped segment satisfies a `[param]` segment. Only a placeholder,
 * though: a literal segment must match literally, or `/api/series/collections`
 * would happily "document" `/api/series/[seriesId]`.
 *
 * The trailing guard is what stops `/api/queue` from being satisfied by a
 * mention of `/api/queue/:ownedGameId` — a shorter route hiding inside a longer
 * one is precisely the undocumented case this is looking for.
 */
function mentionedInSkill(route: string): boolean {
  const placeholder = String.raw`(?::\w+|<\w+>|\[\w+\]|\{\w+\}|\$\w+)`;
  const pattern = route
    .split("/")
    .map((segment) => (/^\[.+\]$/.test(segment) ? placeholder : segment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")))
    .join("/");
  return new RegExp(`${pattern}(?![\\w/:<[{$-])`).test(SKILL_TEXT);
}

/** The domain a route belongs to, so the failure can name the file to write in. */
function referenceFileFor(route: string): string {
  const segments = route.split("/").filter(Boolean).slice(1);
  const domain = segments.find((s) => !s.startsWith("[")) ?? "games";
  const known: Record<string, string> = {
    games: "games",
    facts: "facts",
    enrichment: "facts",
    tags: "tags",
    codes: "codes",
    maps: "maps",
    bookmarks: "bookmarks",
    manuals: "manuals",
    "manual-pages": "manuals",
    series: "series",
    "series-entries": "series",
    music: "music",
    sessions: "play",
    queue: "play",
    import: "games",
  };
  return `reference/${known[domain] ?? "<domain>"}.md`;
}

describe("skill coverage", () => {
  it("finds the routes and the skill at all", () => {
    // A guard on the guards. Every assertion below is of the form "this list of
    // offenders is empty", and an empty list is also what you get when the walk
    // found nothing — a moved directory would turn this whole file into a test
    // that passes by not looking.
    expect(ROUTES.size).toBeGreaterThan(40);
    expect(SKILL_TEXT.length).toBeGreaterThan(10_000);
    expect(walkFiles(SKILL_DIR).length).toBeGreaterThan(5);
  });

  it("every route+method an agent may drive has a gx command", () => {
    const offenders: string[] = [];
    for (const [route, file] of [...ROUTES].sort()) {
      if (ALLOWLISTED.has(route)) continue;
      for (const method of methodsOf(file)) {
        // Deliberately "some", not "exactly one": `gx play start` and
        // `gx play log` are both POST /api/games/[id]/sessions, and
        // `gx play finish` and `gx play edit` are both PATCH
        // /api/sessions/[sessionId] (GAMEEXPLOR-0031). Two commands over one
        // endpoint is a difference in what the agent is being asked to do, not
        // a duplicate.
        if (COMMANDS.some((c) => c.route === route && c.method === method)) continue;
        offenders.push(
          `${method} ${route} has no gx command. Add one to src/lib/gx/registry.ts with route: "${route}" and method: "${method}" ` +
            `(copy the path from the directory tree, the verb from the exported function), or — if an agent must never drive it — ` +
            `add "${route}" to ALLOWLIST in src/lib/skills/coverage.test.ts with a one-line reason.`,
        );
      }
    }
    expect(offenders).toEqual([]);
  });

  it("every route an agent may drive is mentioned in the curate-collection skill", () => {
    // Existence, not correctness: a route named in a reference file is a route
    // an agent can find when it needs one. Whether the payload beside it is
    // right is a review problem — but a route mentioned nowhere is invisible,
    // and an agent that cannot see a capability invents a worse way to get the
    // job done.
    const offenders: string[] = [];
    for (const route of [...ROUTES.keys()].sort()) {
      if (ALLOWLISTED.has(route)) continue;
      if (mentionedInSkill(route)) continue;
      offenders.push(
        `${route} is documented nowhere under .claude/skills/curate-collection/. Write it up in ${referenceFileFor(route)} ` +
          `(":param" and "<param>" placeholders both count, so use whichever reads better), or — if an agent must never drive it — ` +
          `add "${route}" to ALLOWLIST in src/lib/skills/coverage.test.ts with a one-line reason. ` +
          `Remember the mirror: whatever you write under .claude/skills/ has to be copied to .agents/skills/ too.`,
      );
    }
    expect(offenders).toEqual([]);
  });

  it("every skill both clients ship is byte-identical in both trees", () => {
    // Codex reads `.agents/`, Claude reads `.claude/`, and the two have drifted
    // once already — which means for some window one client was working from
    // instructions the other had corrected. There is no merge story here and no
    // intent to have one: a shared skill is one document with two homes.
    //
    // **What is asserted is the mirror relationship, not the tree contents**,
    // and that is a reconciliation of two halves of GAMEEXPLOR-0030 that
    // disagreed with each other. The ticket's third assertion says to walk both
    // trees and compare them; its "Not doing" section says it is "not enforcing
    // anything about `.claude/skills/` other than this one skill; other skills
    // may come and go". A literal whole-tree walk honours the first and breaks
    // the second: the day someone adds a Claude-only design or UI skill with no
    // Codex counterpart, the build goes red demanding they mirror a file that
    // has no business being mirrored. So, ruled by the architect and written
    // down here so nobody "fixes" it back:
    //
    // 1. `curate-collection` must exist in **both** trees, asserted by name. It
    //    is the shared agent interface; if it disappears from `.agents/skills/`,
    //    Codex is curating the collection blind, and that should fail loudly
    //    rather than pass quietly as "a Claude-only skill".
    // 2. Any skill present in **both** trees must be byte-identical. This is the
    //    drift check that has already earned its keep, and it extends itself to
    //    any future shared skill with nobody having to remember to add it.
    // 3. A skill present in only **one** tree is fine. That is a deliberate
    //    Claude-only or Codex-only skill, which is exactly what "other skills
    //    may come and go" permits.
    //
    // Note that the `GAME_EXPLORER_URL:-` assertion below still walks both trees
    // in full, deliberately. It has no false-positive mode — a localhost
    // fallback is wrong in a Claude-only skill too.
    const claudeSkills = skillNames(CLAUDE_SKILLS);
    const agentSkills = skillNames(AGENT_SKILLS);
    const fix = "Copy the skill across rather than editing one side: `rm -rf .agents/skills/<skill> && cp -R .claude/skills/<skill> .agents/skills/<skill>`.";

    expect(
      { claude: claudeSkills.includes(SHARED_SKILL), agents: agentSkills.includes(SHARED_SKILL) },
      `${SHARED_SKILL} must exist in both .claude/skills/ and .agents/skills/. It is the shared agent interface — the one skill both ` +
        `Claude and Codex drive the collection with — so a copy missing from either tree means that client is curating blind. ${fix}`,
    ).toEqual({ claude: true, agents: true });

    const shared = claudeSkills.filter((name) => agentSkills.includes(name));
    const offenders: string[] = [];

    for (const skill of shared) {
      const claudeFiles = walkFiles(path.join(CLAUDE_SKILLS, skill));
      const agentFiles = walkFiles(path.join(AGENT_SKILLS, skill));

      for (const rel of claudeFiles) {
        if (!agentFiles.includes(rel)) offenders.push(`.claude/skills/${skill}/${rel} has no counterpart in .agents/skills/${skill}/ — Codex cannot see it. ${fix}`);
      }
      for (const rel of agentFiles) {
        if (!claudeFiles.includes(rel)) offenders.push(`.agents/skills/${skill}/${rel} has no counterpart in .claude/skills/${skill}/ — Claude cannot see it. ${fix}`);
      }
      for (const rel of claudeFiles.filter((r) => agentFiles.includes(r))) {
        const claude = fs.readFileSync(path.join(CLAUDE_SKILLS, skill, rel));
        const agent = fs.readFileSync(path.join(AGENT_SKILLS, skill, rel));
        if (!claude.equals(agent)) offenders.push(`.agents/skills/${skill}/${rel} differs from .claude/skills/${skill}/${rel} — the two clients are reading different instructions. ${fix}`);
      }
    }

    expect(offenders).toEqual([]);
    // A skill in one tree only is allowed, but a *shared* set that is empty
    // would mean this assertion compared nothing at all.
    expect(shared).toContain(SHARED_SKILL);
  });

  it("no skill file defaults GAME_EXPLORER_URL to anything", () => {
    // `${GAME_EXPLORER_URL:-http://localhost:3000}` is the line that started
    // all of this. It reads as a convenience and behaves as a silent redirect:
    // the write returns 200, the dev database takes it, and the owner's shelf
    // never changes. There is no safe default for "which collection am I
    // editing", which is why `gx` refuses to run without the variable rather
    // than filling one in — and why the fallback must not exist in prose
    // either, where a future agent would copy it out of a code block.
    const offenders: string[] = [];
    for (const [label, dir] of [
      [".claude/skills", CLAUDE_SKILLS],
      [".agents/skills", AGENT_SKILLS],
    ] as const) {
      for (const rel of walkFiles(dir)) {
        const lines = fs.readFileSync(path.join(dir, rel), "utf8").split("\n");
        lines.forEach((line, i) => {
          if (!line.includes("GAME_EXPLORER_URL:-")) return;
          offenders.push(
            `${label}/${rel}:${i + 1} defaults GAME_EXPLORER_URL — a shell fallback that silently retargets a write at the local dev ` +
              `database, where it looks like success and changes nothing the owner will see. Delete the fallback and use "$GAME_EXPLORER_URL" bare; ` +
              `if the variable is unset the right behaviour is to stop and ask which server, not to guess.`,
          );
        });
      }
    }
    expect(offenders).toEqual([]);
  });

  it('SKILL.md still refuses the journal by name in "Never write these"', () => {
    // The one positive assertion. Everything above tests that capabilities are
    // reachable; this tests that a deliberate refusal is still *stated*. An
    // allowlist entry only means "no command lives here", which is
    // indistinguishable from an oversight. The paragraph in SKILL.md is what
    // makes it a decision an agent can repeat back — and deleting that
    // paragraph while leaving the allowlist alone would turn the journal from a
    // documented refusal into exactly the undocumented gap this file exists to
    // find.
    const skill = fs.readFileSync(path.join(SKILL_DIR, "SKILL.md"), "utf8");
    const section = skill.split(/^#{2,4}\s+Never write these\s*$/m)[1];

    expect(
      section,
      'SKILL.md has no "Never write these" section. The journal has no agent write path by design (GAMEEXPLOR-0009); ' +
        "restore the section and name the routes it refuses, or an agent reading this skill has no way to tell a refusal from an oversight.",
    ).toBeDefined();

    const body = (section ?? "").split(/^#{2,3}\s/m)[0];
    const missing = REFUSED_IN_SKILL.filter((route) => !body.includes(route));
    expect(
      missing,
      `The "Never write these" section no longer names ${missing.join(", ")}. These routes are on ALLOWLIST in ` +
        "src/lib/skills/coverage.test.ts, so nothing else in this file will complain about them — the section is the only place the " +
        "refusal is written down. Name them there (bracket spelling, as the route files spell them) or, if the decision has genuinely " +
        "changed, remove them from ALLOWLIST and give them a gx command and a reference file like any other capability.",
    ).toEqual([]);
  });
});
