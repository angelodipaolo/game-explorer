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
| `scripts/deploy.sh` | On the mini: pull, install, back up, migrate, build, restart the LaunchAgent |

## Architecture constraints (decided — do not re-propose)

- **The seam is the local database schema.** The app reads only local tables.
  Exactly one module talks to IGDB: `src/lib/igdb/`. Nothing outside
  `src/lib/igdb/` and `src/lib/catalog/` may import it — enforced by
  `src/lib/igdb/boundary.test.ts`.
- **No provider interface or plugin abstraction.** One catalog source, IGDB.
- **No RAWG.** Rejected: similarity is paywalled, retro player data is thin.
- **Hosted on the owner's Mac mini behind a Cloudflare Tunnel**
  (`https://games.angelodipaolo.com`, GAMEEXPLOR-0002). SQLite and every blob
  directory stay files on that disk. One owner password + named bearer tokens;
  no accounts, no roles, no Postgres, no hosted database, no blob storage.
  Reads are public and unindexed; every write is the owner. Auth lives in the
  app (`src/lib/auth.ts`, enforced in `src/proxy.ts`) rather than at the edge,
  because the same token has to work for the skills and a future iOS client.
  Ops runbook: `ops/README.md`.
- **That mini is the source of truth for collection data, and a checkout's
  `prisma/dev.db` is a disposable dev copy.** Curation and enrichment — games,
  facts, tags, codes, maps, bookmarks, manuals, series — always go to
  `$GAME_EXPLORER_URL` through the API, never to a local database and never
  through Prisma directly. If `GAME_EXPLORER_URL` is unset, stop and ask rather
  than falling back to `localhost`: writing to the wrong collection returns a
  clean 200 and silently changes nothing the owner will see. The local copy is
  for building and debugging the app. Local is for code, the mini is for data.
- **No cost, price, ROI, or resale tracking.** That is `game-manage`'s job.
  Carve-out, GAMEEXPLOR-0008: outbound price-lookup links are in — the game
  page links out to a PriceCharting and eBay search for the copy you own
  (`src/lib/links.ts` builds the URLs). Links only. Fetching a price,
  showing one, or storing one stays out.
- **No live LLM on any browse-time path.** Similarity comes from IGDB; AI is
  confined to batch enrichment via skills under `.claude/skills/`.
- **No column-mapping import wizard.** Import is an API driven by an agent
  (`.claude/skills/curate-collection/`, `reference/games.md`) or a CSV drop
  that creates a session.
- **No ratings, and no user-created named playlists.** Still out, deliberately.
  One ordered play queue ("up next") is in, per GAMEEXPLOR-0009 — a decision
  about what to play next, not a filing system.
- **Play history is in** (GAMEEXPLOR-0009, decided 2026-08-30): play sessions,
  journal notes and photos on an owned copy. Derived from a log of
  `PlaySession` rows — there is no status column on `OwnedGame` and there must
  never be one, or replaying a game becomes unrepresentable.
- **Agents do not write game guides.** They research and source material and
  record it with a citation, the way `curate-collection` (maps, codes,
  bookmarks) does. A prose walkthrough authored by an agent has no
  citation granularity, which is the one thing every write path here refuses to
  produce. A structured walkthrough would have to be an ordered list of steps
  with a source per step. Bookmarks (GAMEEXPLOR-0010) are the sanctioned shape:
  link the real GameFAQs guide with one line saying why — the bookmark *is* its
  own citation, which is why `GameBookmark` has no `sourceUrl`.
- **Series are IGDB-seeded and human-pruned** (GAMEEXPLOR-0011). A series is an
  ordered list of *catalog* games — membership is by IGDB id, ownership is
  resolved at render time — so the page can show the gap where the one you do
  not own should be. An IGDB collection only ever *proposes*: nothing publishes
  one automatically, there is no auto-membership, and `Series.seenIgdbIds`
  records every id a prune was shown so a rejected port never comes back as
  "new". Codes-and-maps stance: no `source` column and no precedence on
  `Series` or `SeriesEntry` — one API for the owner and for a research skill.
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
- `data/journal/` (journal photos), `data/manuals/` (manual page scans, keyed
  by `ManualPage` id) and `data/music/` (the owner's own soundtrack MP3s, keyed
  by `MusicTrack` id) hold bytes that, like `data/maps/`, are **not** in
  `db:snapshot`. `npm run backup` is what captures all four — a new blob
  directory must be added to `BLOB_DIRS` in `scripts/backup.ts`, and the table
  behind it to both snapshot scripts.
- Any source database (e.g. `game-manage`) is read read-only; never write to it.

## Secrets

`.env` holds a live Twitch client secret, and since GAMEEXPLOR-0002 also
`OWNER_PASSWORD`, `AUTH_SECRET` and `API_TOKENS` — the keys to every write path
on the public site. It is gitignored. Never print it, never commit it, never
copy it into notes. `.env.example` documents the names and nothing else.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
