# Game Explorer

A local-first web app for a physical game collection: browse it as cover
art, narrow it to "2 of us, co-op, NES", flip through the matches across a
room, open a game and decide. It runs on the owner's Mac mini and is reached
from phones on the wifi and, through a Cloudflare Tunnel, from anywhere:
public read, owner write, one password and no accounts (GAMEEXPLOR-0002).

## Where the collection lives — read this before writing any data

**The Mac mini is the source of truth.** The real collection — games, facts,
tags, codes, maps, bookmarks, manuals, series, play history, journal, and the
image files behind them — lives on the mini and is reached over HTTP at
`$GAME_EXPLORER_URL`. The `prisma/dev.db` in *this* checkout is a **disposable
dev copy**: nothing written to it reaches the collection, and it is overwritten
whenever someone refreshes it from the mini's backup.

- **Curation and enrichment always go to `$GAME_EXPLORER_URL` through the
  API** — adding a game, a code, a map, a tag, a bookmark, a manual page, a
  series. Use the skills in `.claude/skills/`. Never write collection data to
  the local database, never through Prisma directly, and never by pointing a
  skill at `localhost`.
- **If `GAME_EXPLORER_URL` is unset, stop and ask.** Do not fall back to
  localhost. Writing to the wrong collection looks exactly like success and
  stays invisible until the owner notices the game never appeared on their
  shelf.
- **The local copy is for building and debugging the app**: `npm run dev`,
  tests, migrations, throwaway seed rows. Write freely there — just never call
  it the collection.

Local is for code. The mini is for data.

Read `AGENTS.md` too — it holds the architecture constraints and the block
Next.js maintains itself. If this checkout is managed by Sabin (`sabin context --json`), the ticket
notes hold the plan, `decisions.md`, and `import-report.md`; read them before
re-litigating anything about matching, quantities, or game types.

## Stack

Next.js 16 (App Router, Turbopack) · React 19 · TypeScript strict · Tailwind 4 ·
Prisma 6 on SQLite (`prisma/dev.db`) · Zod 4 · Vitest · Playwright.
Next 16 differs from older Next: async `params`/`searchParams`, `proxy.ts` not
`middleware.ts`. Docs are in `node_modules/next/dist/docs/`.

## Commands

```bash
npm run dev            # http://localhost:3000 — the local DEV COPY, never the collection
npm run check          # lint + typecheck + unit tests + build — run before every commit
npm run test:e2e       # Playwright, desktop + phone; reuses a running dev server on :3000
npm run db:restore     # rebuild the local dev prisma/dev.db from data/snapshot.json
npm run db:snapshot    # export the local dev DB to data/snapshot.json
npm run catalog:sync   # refresh every linked catalog entry from IGDB
scripts/deploy.sh      # on the Mac mini only: pull → build → restart the service (ops/README.md)
npm run backup         # one tar.gz of prisma/dev.db + data/ into backups/ (-- --out <dir>)
npm run images:warm    # pre-fill .cache/igdb-images with every cover + screenshot
```

Only one `next dev` can run per directory in Next 16; Playwright's config
reuses the one on port 3000.

## Where things are

| Path | What |
| --- | --- |
| `prisma/schema.prisma` | The seam. `OwnedGame`/`GameFact`/import tables = what the owner owns; `CatalogGame` = what IGDB knows. |
| `src/lib/igdb/` | The only code that talks to IGDB. Client (token, 4 req/s, 429 backoff), query builder, schemas. |
| `src/lib/catalog/` | Matching (`match.ts`: confidence scoring), normalization, `sync.ts` (upsert + parent backfill), `index.ts` (the `CatalogPort` everything else uses). |
| `src/lib/import/` | Staged import: sessions → rows → decisions → one transactional commit → batch rollback. |
| `src/lib/enrichment/` | Agent-written facts with citations; never overwrite manual facts. |
| `src/lib/facts.ts` | Resolves player facts: manual > agent > IGDB tiers > derived. |
| `src/lib/codes/` | Passwords, cheats, Game Genie / Action Replay codes per owned copy. No `source` column and no precedence — a code you typed and a code a skill wrote are one kind of record. |
| `src/lib/images/` | Disk cache for IGDB art: `.cache/igdb-images/<size>/<id>.jpg`, served by `/api/img/:size/:imageId`, which backfills on a miss and 307s to the CDN when offline. The only place `images.igdb.com` is named. |
| `src/lib/maps/` | Interactive maps: `GameMap` (image on disk under `data/maps/`, served by `/api/maps/:id/image`) + `MapMarker` in image pixels. Same no-`source`, no-precedence stance as codes. Viewer is `src/components/maps/map-viewer.tsx`. |
| `src/lib/bookmarks/` | Reference links per owned copy — guide / wiki / video / longplay / article, each with a required `why` line. Same no-`source`, no-precedence stance as codes; the bookmark **is** its own citation, so there is no `sourceUrl`. Section is `src/components/game/bookmarks.tsx`. |
| `src/lib/manuals/` | Scanned manuals: `GameManual` + `ManualPage` (dense `position` 0..n-1), page images on disk under `data/manuals/`, served by `/api/manual-pages/:pageId/image`. Viewer is `src/components/manuals/manual-viewer.tsx`. |
| `src/lib/series/` | Series: ordered lists of **catalog** games (`Series`/`SeriesEntry`, membership by IGDB id, ownership resolved at render). `shape.ts` is the pure half (slug, `?missing`, sections, the seed diff); `service.ts` the DB half. Seeded from an IGDB collection via `src/lib/catalog/collections.ts`, then pruned by hand — nothing auto-publishes. |
| `src/lib/owned-match.ts` | `matchSimilarToOwned` — the one rule for checking IGDB ids against the shelf (through parents both ways). Re-exported by `collection.ts`. |
| `src/lib/tags.ts`, `src/lib/tags/` | Tags: IGDB genres/perspectives/themes ∪ manual ∪ agent − hidden. Manual beats agent; IGDB tags hide, never delete. |
| `src/lib/play/` | Play history and the one ordered "up next" queue. `PlaySession` rows are the log play state is derived from; `startSession` dequeues in the same transaction. No agent write path. |
| `src/lib/journal/` | Dated notes and photos per owned copy (`kind: note \| photo`), optionally tied to the run they were written during. Photos live in `data/journal/`, served by `/api/journal/:entryId/image`. No agent write path. |
| `src/lib/music/` | Background music while you browse a game (GAMEEXPLOR-0025). `MusicTrack` rows per **owned copy** + one MP3 each on disk, exactly like maps and manuals: `service.ts` is the DB half, `audio.ts` the disk half (`MUSIC_DIR`, the store, `Range` parsing), `player.ts` the browser half (per-device `localStorage` setting, pathname → game, random pick). Owner-supplied MP3s only — nothing here fetches, converts or generates audio. |
| `src/lib/media/` | `createFileStore(dir, formats)` — the one on-disk blob store, behind `data/maps/`, `data/journal/`, `data/manuals/` and `data/music/`. `image-store.ts` (`createImageStore` + `sniffImage`) and `audio-store.ts` (`createAudioStore` + `sniffAudio`) are thin wrappers over it. Reuse them; never hand-roll a path. |
| `src/lib/auth.ts`, `src/proxy.ts` | One owner password + named bearer tokens; the gate in front of every `/api/*` route and the `noindex` header. `src/lib/viewer.ts` turns the cookie into `canEdit` for pages. |
| `ops/` | Hosting: the LaunchAgent and `cloudflared` templates, and the runbook for the Mac mini. |
| `src/lib/collection.ts` | Shelf/game view models. `groupShelf` collapses one game on several platforms into one entry (and rolls play state up across copies). `loadPlaying` is the `/playing` view model. |
| `src/lib/home.ts` | Home's rows: a pool of candidate filters (tag×platform, tag, players, era, platform, never-played, series), a fixed 6–8 drawn per day by `daySeed`, quality-gated. Pure — components stay thin. |
| `src/lib/filters.ts` | URL ⇄ filter state; three-valued verdicts (yes / no / unknown). `play` is the one two-valued filter — it reads your own log, not IGDB, so "never played" is a fact and not a gap. |
| `src/lib/platforms.ts` | Platform slugs, aliases, IGDB ids. Add new consoles here. |
| `src/app/` | `/` home (carousels, tonight's picks, what you're playing), `/shelf` the grid + filters, `/flip` room mode, `/game/[id]`, `/playing` (in progress + up next), `/import`, `/api/import/*`, `/api/enrichment/*`, `/api/games/[id]/facts`, `/api/codes/*`, `/game/[id]/map`, `/api/games/[id]/maps`, `/api/maps/*`, `/api/games/[id]/sessions`, `/api/sessions/*`, `/api/queue*`, `/api/games/[id]/journal`, `/api/journal/*`, `/api/games/[id]/bookmarks`, `/api/bookmarks/*`, `/game/[id]/manual`, `/api/games/[id]/manuals`, `/api/manuals/*`, `/api/manual-pages/*`, `/series`, `/series/[slug]` (owned by default, `?missing=1` reveals the rest), `/series/new`, `/api/series/*`, `/api/series-entries/*`, `/settings` (per-device preferences), `/api/games/[id]/music`, `/api/music/[trackId]`, `/api/music/[trackId]/audio`. |
| `src/components/shelf/` | Toolbar, presets, genre row, filter sheet, cards, `use-filters.ts`. |
| `src/components/game/play-history.tsx`, `journal.tsx` | The two write surfaces on the game page: runs (start / finish / past runs / queue) and the journal feed with its client-side photo downscale. |
| `.claude/skills/` | `curate-collection` — the one agent playbook for every write path (games, facts, tags, codes, maps, bookmarks, manuals, series, music), with a `reference/*.md` file per domain. |
| `scripts/` | Baseline/import/snapshot tooling. `scratch/` is gitignored throwaway. |
| `data/snapshot.json` | Your collection export — gitignored, private. See `data/README.md`. |
| `data/maps/` | Map images, one file per `GameMap` id. Gitignored, **not in the snapshot** — back it up with it. |
| `data/manuals/` | Manual page scans, one file per `ManualPage` id (`MANUALS_DIR` overrides). Gitignored, **not in the snapshot** — same stance as `data/maps/`. |
| `data/music/` | The owner's own soundtrack MP3s, one file per `MusicTrack` id (`MUSIC_DIR` overrides). Gitignored, **not in the snapshot** (the rows are; the audio is not), never under `public/`, never committed. |

## Invariants (the ones that bite silently)

- **Collection writes go to the mini, never to the local database.** The shelf
  the owner sees lives at `$GAME_EXPLORER_URL`; `prisma/dev.db` here is a
  disposable copy. An agent that curates into the local copy gets a clean 200
  and changes nothing the owner will ever see — the failure is silent by
  construction, which is why the rule is absolute. Unset `GAME_EXPLORER_URL`
  means stop and ask, not fall back to localhost.
- **Every IGDB game query carries a `game_type` filter.** Default is
  `(0,3,8,9,10,11)`; mod/DLC/pack types throw. See `decisions.md` for why
  `= 0` alone was wrong.
- **Absent and `0` both mean unknown** for IGDB player counts.
- **Filters are three-valued.** Unknown data is shown separately, never hidden
  as a "no" — ~85% of the shelf has co-op yes/no, only ~30% exact counts.
- **Filter state is the URL.** Any view must be linkable. `use-filters.ts`
  writes it with native `history.replaceState` (no server round trip — the
  shelf is filtered client-side), debounces the search box, and restores the
  saved view once on mount only. Never rewrite the URL from effects and never
  use `router.replace` for filter changes: it re-renders the server page and
  re-sends the whole collection.
- **Nothing outside `src/lib/igdb` and `src/lib/catalog` imports the IGDB
  client** — `boundary.test.ts` enforces it.
- **Imports go through the API** (`POST /api/import/sessions`), never a
  private write path. Every commit is an undoable batch.
- **Every `/api/*` route is behind `src/proxy.ts`.** A new route is
  authenticated the moment it exists; never add a credential check inside a
  route handler and never exempt one from the proxy. The only exemptions are
  `/api/auth/*` and the public image reads — all of `/api/img/*` plus `GET` on
  `/api/maps/:id/image`, `/api/journal/:id/image` and
  `/api/manual-pages/:id/image` — because every public page is made of those
  pixels. Owner-only *pages* (`/import/*`, `/series/new`) redirect to `/login`;
  every write control in the UI renders only when the server-derived `canEdit`
  says so (`src/lib/viewer.ts`).
- **Manual facts and tags are never overwritten** by IGDB sync or agents.
  Codes, maps, bookmarks and manuals are the deliberate exception: they are
  lists, not contested values, so `GameCode`, `GameMap`, `MapMarker`,
  `GameBookmark`, `GameManual` and `ManualPage` have no `source` and no
  precedence at all — and so do `Series` and `SeriesEntry`.
- **A series is IGDB-seeded, human-pruned.** `collection.games[]` proposes; what
  is stored is what someone kept. `Series.seenIgdbIds` records every id a prune
  was *shown*, which is what makes "new since the last check" honest and why a
  rejected port never comes back. Nothing auto-publishes a collection.
- **`.env` holds a live Twitch secret.** Never print or commit it.
- **Play state is derived from the `PlaySession` log, never stored.** There is
  no `OwnedGame.status` and there must never be one — a status column cannot
  represent playing a game twice. `endedAt is null` is the only definition of
  "playing now", and the `play` filter is two-valued because of it: no rows
  means never played, which is a fact and not a gap.
- **`data/journal/`, `data/manuals/` and `data/music/` are outside the
  snapshot**, like `data/maps/`: the snapshot carries the rows, the files carry
  the pixels (and, for music, the sound). `npm run backup` archives all four.
  Journal photos are downscaled in the browser (2400px, JPEG q0.85) before
  upload. Note the one gap all four share: the service delete paths unlink the
  files, but a **SQL cascade does not** — an import rollback that removes an
  `OwnedGame` takes the rows and leaves the bytes. Orphaned files are harmless, just never reclaimed.
- **Music is owner-supplied, off by default, and served only by id.** The
  files in `data/music/` are the owner's own; `curate-collection` registers
  them through the API and never downloads, converts or generates any.
  `GET /api/music/:trackId/audio` and `GET /api/games/:id/music` are public
  reads like the image routes — every other verb on them is not — and they take
  a row id, never a path: the id must be a bare cuid, must name a `MusicTrack`,
  and the resolved file is re-checked against `data/music/` through
  `fs.realpath`, so a symlink out of the directory is refused too. The toggle
  lives in `localStorage` per device (`/settings`), and `play()` is never
  called before a real (`isTrusted`) user gesture.
- **Agents research and source reference material; they never author it.**
  `curate-collection` links the real guide and writes one line saying why — a
  bookmark is its own citation. An agent-written prose walkthrough has no
  citation granularity and stays out; see AGENTS.md.
- **Migration `20260831032612_one_open_run_per_copy` is hand-written SQL.** It
  is a partial unique index, which Prisma cannot express — `prisma migrate
  diff` will not regenerate it, and a `db push`-style test database would
  silently lack it.
- **A new table must be added to `scripts/db-snapshot.ts` and
  `scripts/db-restore.ts` by hand.** Both enumerate tables explicitly; miss one
  and every row of it vanishes on the next `npm run db:restore`. The list today:
  catalog, import session/row/batch/effect, `OwnedGame`, `GameFact`, `GameTag`,
  `GameCode`, `GameMap`, `MapMarker`, `GameBookmark`, `GameManual`,
  `ManualPage`, `MusicTrack`, `PlaySession`, `JournalEntry`, `QueueEntry`,
  `EnrichmentRun`. A table holding blobs also needs its directory in
  `BLOB_DIRS` in `scripts/backup.ts`.
- Quantities are per copy; when a source export repeats rows (test runs,
  re-exports), import at quantity 1 rather than counting rows.

## Verifying UI work

Tests passing is not verification for the shelf, flip, or game pages. Use the
Playwright MCP browser tools: load the real page, drive the flow (filter →
flip → open), read the console, and **screenshot both a desktop width and a
phone width (390px)**. One-handed phone use is a requirement. iPad widths
(768/1024) should also lay out. Safari cannot be driven here — Playwright's
WebKit is the closest proxy (`npx playwright install webkit`).

Collection-size assertions live in `e2e/shelf.spec.ts` and `e2e/smoke.spec.ts`
("All N games"); update them after an import.

## Conventions

- Commit at each verified milestone with the ticket id in the message
  (`GAMEEXPLOR-0001: …`); never commit a red state.
- Keep durable findings in the notes directory (Sabin) when one exists, not in chat.
- Don't add: RAWG, a provider abstraction, hosting, auth, fetched/stored/shown
  prices, live LLM calls on browse paths, a column-mapping wizard,
  ratings/playlists, agent-written game guides, or a play-status column on
  `OwnedGame`. Outbound price-lookup links (the PriceCharting/eBay searches on
  the game page, `src/lib/links.ts`, GAMEEXPLOR-0008) are the one price-shaped
  thing that is in.
