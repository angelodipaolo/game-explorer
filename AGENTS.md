# Game Explorer — agent notes

Local-first web app for browsing a physical game collection and deciding
what to play. Next.js 16 (App Router) + React 19 + TypeScript strict, Tailwind 4,
Prisma 6 on SQLite, Zod 4. Tests: Vitest (unit/integration) and Playwright (e2e).

## Commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Dev server, bound to `0.0.0.0` so phones on the LAN can reach it |
| `npm run check` | Lint, typecheck, unit tests, build — the gate before any commit |
| `npm run test` / `npm run test:e2e` | Vitest / Playwright |
| `npm run db:migrate` | Apply Prisma migrations to `prisma/dev.db` |
| `npm run db:restore` | Rebuild `prisma/dev.db` from the committed snapshot in `data/` |
| `npm run db:snapshot` | Export the current database to `data/` so it ships with the repo |
| `npm run backup` | One restorable archive of `prisma/dev.db` + `data/` in `backups/` (`-- --out <dir>` to put it elsewhere) |

## Architecture constraints (decided — do not re-propose)

- **The seam is the local database schema.** The app reads only local tables.
  Exactly one module talks to IGDB: `src/lib/igdb/`. Nothing outside
  `src/lib/igdb/` and `src/lib/catalog/` may import it — enforced by
  `src/lib/igdb/boundary.test.ts`.
- **No provider interface or plugin abstraction.** One catalog source, IGDB.
- **No RAWG.** Rejected: similarity is paywalled, retro player data is thin.
- **No hosting, Postgres, auth, or accounts.** SQLite, local + LAN only.
- **No cost, price, ROI, or resale tracking.** That is `game-manage`'s job.
  Carve-out, GAMEEXPLOR-0008: outbound price-lookup links are in — the game
  page links out to a PriceCharting and eBay search for the copy you own
  (`src/lib/links.ts` builds the URLs). Links only. Fetching a price,
  showing one, or storing one stays out.
- **No live LLM on any browse-time path.** Similarity comes from IGDB; AI is
  confined to batch enrichment via skills under `.claude/skills/`.
- **No column-mapping import wizard.** Import is an API driven by an agent
  (`.claude/skills/import-collection/`) or a CSV drop that creates a session.
- **No ratings, and no user-created named playlists.** Still out, deliberately.
  One ordered play queue ("up next") is in, per GAMEEXPLOR-0009 — a decision
  about what to play next, not a filing system.
- **Play history is in** (GAMEEXPLOR-0009, decided 2026-08-30): play sessions,
  journal notes and photos on an owned copy. Derived from a log of
  `PlaySession` rows — there is no status column on `OwnedGame` and there must
  never be one, or replaying a game becomes unrepresentable.
- **Agents do not write game guides.** They research and source material and
  record it with a citation, the way `find-maps` and `find-codes` do. A prose
  walkthrough authored by an agent has no citation granularity, which is the
  one thing every write path here refuses to produce. A structured walkthrough
  would have to be an ordered list of steps with a source per step.
- **Agents never author play history or journal entries.** Codes and maps share
  one API between the owner and a research skill because they are public facts
  about a game. A playthrough is not; nobody but the owner can produce it.

## Data rules that are easy to get silently wrong

- Every IGDB game query must include `game_type = 0`. IGDB's NES catalog is
  thick with romhacks; without it `Super Mario Bros` matches a fan hack.
- Player data has two tiers. `game_modes` (85% coverage) gives co-op yes/no;
  `multiplayer_modes` (20%) gives exact counts. Absent numeric fields are
  omitted *or* returned as `0` — both mean "unknown", never "zero players".
- `simultaneousPlay` is derived by us, not modelled by IGDB.
- Fact precedence is `manual > agent > igdb`. A `manual` value is never
  overwritten by IGDB sync or an agent. Agents cite a source per claim and
  leave a field null rather than guess.
- **Play history and journal entries have no agent write path.** No skill, no
  batch endpoint, no `gaps` route — agents never author them. Codes and maps
  are public facts about a game and share one API with a research skill; a
  playthrough is not, and an agent inventing one would be fabricating a memory.
- Play state is **derived** from `PlaySession` rows (`endedAt is null` is
  "playing now"), never stored on `OwnedGame`.
- Migration `20260831032612_one_open_run_per_copy` is **hand-written SQL** — a
  partial unique index Prisma's schema language cannot express, so
  `prisma migrate diff` will not regenerate it. Never squash or rewrite it away.
- `data/journal/` holds journal photo bytes and, like `data/maps/`, is **not**
  in `db:snapshot`. `npm run backup` is what captures both.
- Any source database (e.g. `game-manage`) is read read-only; never write to it.

## Secrets

`.env` holds a live Twitch client secret. It is gitignored. Never print it,
never commit it, never copy it into notes.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
