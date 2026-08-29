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

## Architecture constraints (decided — do not re-propose)

- **The seam is the local database schema.** The app reads only local tables.
  Exactly one module talks to IGDB: `src/lib/igdb/`. Nothing outside
  `src/lib/igdb/` and `src/lib/catalog/` may import it — enforced by
  `src/lib/igdb/boundary.test.ts`.
- **No provider interface or plugin abstraction.** One catalog source, IGDB.
- **No RAWG.** Rejected: similarity is paywalled, retro player data is thin.
- **No hosting, Postgres, auth, or accounts.** SQLite, local + LAN only.
- **No cost, price, ROI, or resale tracking.** That is `game-manage`'s job.
- **No live LLM on any browse-time path.** Similarity comes from IGDB; AI is
  confined to batch enrichment via skills under `.claude/skills/`.
- **No column-mapping import wizard.** Import is an API driven by an agent
  (`.claude/skills/import-collection/`) or a CSV drop that creates a session.
- **No ratings, play-status tracking, or playlists** in v1.

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
- Any source database (e.g. `game-manage`) is read read-only; never write to it.

## Secrets

`.env` holds a live Twitch client secret. It is gitignored. Never print it,
never commit it, never copy it into notes.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
