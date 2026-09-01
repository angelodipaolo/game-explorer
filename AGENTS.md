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
- **Every feature is four layers, in this order: database → REST API → CLI
  command → skill.** State is a Prisma model in `prisma/schema.prisma` with a
  migration — never a JSON file, a directory listing, a YAML manifest or an env
  var. It is reached through routes under `src/app/api/`, behind `src/proxy.ts`.
  Every route an agent may drive gets a `gx` command (`npm run gx -- …`), and
  that pairing is asserted in code rather than in prose, from both ends:
  `src/lib/gx/registry.test.ts` checks that every command names a real route
  with a verb that route exports, and `src/lib/skills/coverage.test.ts` checks
  the direction that matters here — every route an agent may drive has a
  command and a line in the skill, or sits on a short allowlist that says why
  it does not (GAMEEXPLOR-0036, GAMEEXPLOR-0030). `curl` stays legal and stays
  documented — the CLI is the front door, not the only door. The command and
  its payload shapes are written down in `.claude/skills/curate-collection/`,
  mirrored into `.agents/skills/`.
  **Reads count, not just writes** — an agent that cannot list a thing cannot
  act on it, which is why `GET /api/games?q=` had to exist before any of the
  rest was usable (GAMEEXPLOR-0028). Blobs are the one carve-out: bytes go on
  disk through `src/lib/media/`, but the *row that names them* is a table
  (`GameMap`, `ManualPage`, `JournalEntry`, `MusicTrack`). A feature that stops
  at the database is invisible to agents; one that stops at the API is
  reachable but undiscoverable, because nobody guesses a route exists. The
  worked example of the wrong shape is music: it was first built as a
  hand-edited `data/music/index.json` with read-only routes, which the phone
  could not write and a remote agent could not reach at all. That was corrected
  before it shipped (GAMEEXPLOR-0025 / GAMEEXPLOR-0032) — `main` has
  `MusicTrack`, a write API and `reference/music.md` — so recognise the shape,
  do not go looking for it in the tree.
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
- **Agents never author journal entries.** Codes and maps share one API between
  the owner and a research skill because they are public facts about a game. A
  playthrough's writing is not: nobody but the owner can produce it, and a
  fabricated memory is undetectable after the fact — unlike a wrong tag or a
  bad code, which is visibly wrong on the page. That is why the journal has no
  agent write path and never will.
  GAMEEXPLOR-0031 opened the other half — play sessions and the queue — under
  **record, never infer**: an agent may write down a run the owner described
  and may plan what is up next, and may never derive a run from a habit, a
  journal entry or a completion percentage. Dictation is not authorship. The
  rule and its refusals live in
  `.claude/skills/curate-collection/reference/play.md`; the journal never opens.

## Data rules that are easy to get silently wrong

- Every IGDB game query must include a `game_type` filter — the default is
  `(0,3,8,9,10,11)`, and `= 0` alone was wrong (see `decisions.md`). IGDB's NES
  catalog is thick with romhacks; without the filter `Super Mario Bros` matches
  a fan hack.
- Player data has two tiers. `game_modes` (85% coverage) gives co-op yes/no;
  `multiplayer_modes` (20%) gives exact counts. Absent numeric fields are
  omitted *or* returned as `0` — both mean "unknown", never "zero players".
- `simultaneousPlay` is derived by us, not modelled by IGDB.
- Fact precedence is `manual > agent > igdb`. A `manual` value is never
  overwritten by IGDB sync or an agent. Agents cite a source per claim and
  leave a field null rather than guess.
- **Journal entries have no agent write path.** No skill, no batch endpoint, no
  `gaps` route, no `gx` command — agents never author them. Codes and maps are
  public facts about a game and share one API with a research skill; a
  playthrough's writing is not, and an agent inventing one would be fabricating
  a memory nothing on the page could contradict.
- **Play sessions and the queue do have one** (GAMEEXPLOR-0031), bounded by
  **record, never infer**: an agent writes down what the owner stated and
  deduces nothing. No `gaps` route here either, because a game with no runs is
  not missing data — it is a game nobody has played. No bulk "mark everything
  played", no timers, no automatic detection.
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
