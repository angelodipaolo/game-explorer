# Game Explorer

A local-first web app for a physical game collection: browse it as cover
art, narrow it to "2 of us, co-op, NES", flip through the matches across a
room, open a game and decide. Runs on one Mac, reachable by phones on the wifi.
No hosting, no accounts.

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
npm run dev            # http://localhost:3000, bound to 0.0.0.0 for the LAN
npm run check          # lint + typecheck + unit tests + build — run before every commit
npm run test:e2e       # Playwright, desktop + phone; reuses a running dev server on :3000
npm run db:restore     # rebuild prisma/dev.db from data/snapshot.json
npm run db:snapshot    # export the DB to data/snapshot.json (commit it after imports)
npm run catalog:sync   # refresh every linked catalog entry from IGDB
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
| `src/lib/maps/` | Interactive maps: `GameMap` (image on disk under `data/maps/`, served by `/api/maps/:id/image`) + `MapMarker` in image pixels. Same no-`source`, no-precedence stance as codes. Viewer is `src/components/maps/map-viewer.tsx`. |
| `src/lib/tags.ts`, `src/lib/tags/` | Tags: IGDB genres/perspectives/themes ∪ manual ∪ agent − hidden. Manual beats agent; IGDB tags hide, never delete. |
| `src/lib/collection.ts` | Shelf/game view models. `groupShelf` collapses one game on several platforms into one entry. |
| `src/lib/filters.ts` | URL ⇄ filter state; three-valued verdicts (yes / no / unknown). |
| `src/lib/platforms.ts` | Platform slugs, aliases, IGDB ids. Add new consoles here. |
| `src/app/` | `/` shelf, `/flip` room mode, `/game/[id]`, `/import`, `/api/import/*`, `/api/enrichment/*`, `/api/games/[id]/facts`, `/api/codes/*`, `/game/[id]/map`, `/api/games/[id]/maps`, `/api/maps/*`. |
| `src/components/shelf/` | Toolbar, presets, genre row, filter sheet, cards, `use-filters.ts`. |
| `.claude/skills/` | `import-collection`, `enrich-collection`, `tag-collection`, `find-codes`, `find-maps` — the agent playbooks for the write paths. |
| `scripts/` | Baseline/import/snapshot tooling. `scratch/` is gitignored throwaway. |
| `data/snapshot.json` | Your collection export — gitignored, private. See `data/README.md`. |
| `data/maps/` | Map images, one file per `GameMap` id. Gitignored, **not in the snapshot** — back it up with it. |

## Invariants (the ones that bite silently)

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
- **Manual facts and tags are never overwritten** by IGDB sync or agents.
  Codes and maps are the deliberate exception: they are lists, not contested
  values, so `GameCode`, `GameMap` and `MapMarker` have no `source` and no
  precedence at all.
- **`.env` holds a live Twitch secret.** Never print or commit it.
- **A new table must be added to `scripts/db-snapshot.ts` and
  `scripts/db-restore.ts` by hand.** Both enumerate tables explicitly; miss one
  and every row of it vanishes on the next `npm run db:restore`.
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
- Don't add: RAWG, a provider abstraction, hosting, auth, pricing, live LLM
  calls on browse paths, a column-mapping wizard, ratings/playlists (v1).
