# Game Explorer

Browse a game collection.

Metadata comes from [IGDB](https://api-docs.igdb.com/) and is cached in local
SQLite tables. The app never calls IGDB at browse time.

## Run it

```bash
cp .env.example .env      # add your Twitch/IGDB credentials
npm install
npm run db:migrate        # creates prisma/dev.db (empty)
# or, if you have a private data/snapshot.json from another machine:
npm run db:restore
npm run dev
```

The dev server binds to `0.0.0.0`, so anything on the same wifi can open it.
Find your machine's LAN address and share it:

```bash
ipconfig getifaddr en0    # macOS — e.g. 192.168.1.42
```

Then open `http://192.168.1.42:3000` on a phone. No login. Add it to the home
screen for a full-screen app.

## What's in it

| Route | What it does |
| --- | --- |
| `/` | The shelf. Cover grid or list; filters in the URL; presets for the usual questions ("2 of us, co-op"); tonight's picks. |
| `/flip?…` | The same filtered set one game at a time, readable across a room. Arrows, swipe, and a 🎲 button. |
| `/game/:id` | Should we play this? Players (with where each fact came from), how long, what it plays like, screenshots, and similar games you already own. |
| `/import` | Drop a CSV, review what the matcher decided, commit. Every commit is one undoable batch. |

Filters are three-valued because the data is sparse: a game is **confirmed**,
**ruled out**, or **unknown**. Unknowns are shown separately instead of
silently dropped; "Only games with confirmed data" hides them.

## Agents

One skill, `.claude/skills/curate-collection/`, drives every write path:
importing games, enrichment facts, tags, codes, maps, bookmarks, manuals and
series, each documented in its own `reference/*.md` file.

- **Importing** — parse anything (CSV, list, photo) into rows, stage a session
  through `POST /api/import/sessions`, resolve what is unambiguous, ask about
  the rest, commit. Undo: `POST /api/import/batches/:id/rollback`.
- **Enrichment facts** — list gaps (`GET /api/enrichment/gaps`), research each
  game, write facts with a citation (`POST /api/enrichment/runs/:id/facts`).
  Agent facts never overwrite hand-set ones (`PUT /api/games/:id/facts`).

Full endpoint list: `src/app/api/**/route.ts`, each with a comment on its shape.

## Data

- `prisma/schema.prisma` — the seam. What you **own** (`OwnedGame`,
  `GameFact`, import sessions/batches) vs. what IGDB **knows** (`CatalogGame`).
- `data/snapshot.json` — a full export of your database, **gitignored** so your
  collection stays private. `npm run db:snapshot` writes it; `npm run db:restore`
  loads it. See `data/README.md`.
- `npm run catalog:sync` refreshes every linked catalog entry from IGDB.
- `npm run import:collection <sqlite copy>` imports from a copy of a
  `game-manage` inventory database, if you have one.

## Checks

```bash
npm run check        # lint + typecheck + unit tests + build
npm run test:e2e     # Playwright: load, filter, flip, open — desktop and phone
```

`AGENTS.md` and `CLAUDE.md` have the architecture constraints and a map of
the code for agents working on the repo. MIT licensed.
