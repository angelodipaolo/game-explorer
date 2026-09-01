---
name: curate-collection
description: The interface to Game Explorer's collection — how you read it and how you change it. One API and one CLI cover the shelf itself and everything hanging off a copy. Use it to answer questions about the collection ("do I own Sonic 2?", "what am I playing?", "what's missing?", "which NES games have no codes?") and for every write to it: import or add games (a CSV, spreadsheet, list, or shelf photo), tag or categorise games ("Metroidvania", "roguelike", "couch co-op"), fill in player counts / co-op / simultaneous-play / playtime facts, find or add Game Genie / Action Replay / password / cheat codes, build interactive maps with markers, find or add reference links (guides, wikis, longplays, articles), scan or organize manuals, register the owner's own soundtrack files as background music for a game, seed/prune/edit a series, and record play state the owner reports ("mark Contra as playing", "I finished this last night", "queue these three up next" — runs and the queue only, never the journal). Also covers "work through the gaps", "enrich the collection", "fill in what's missing", and single-game edits like "add a code to this game", "bookmark a guide for this game" or "add music for this game".
---

# The collection's interface

This is how you reach the owner's game collection: what is on the shelf, and
every kind of data hanging off a copy — facts, tags, codes, maps, bookmarks,
manuals, series, music, runs and the up-next queue. Reads and writes go through
the same API and the same CLI. **How you use it is your call.** There is no
prescribed sequence here: a request to add one game, a request to sweep the
whole NES shelf for passwords, and a question about what is in progress are all
served by the same map, entered at different points. What follows is what
exists, how to reach it, and the handful of rules that are not yours to break.

You are the smart client throughout: the API owns validation, matching,
precedence and the transaction; you own research, judgement, and citations.

## Access

`npm run gx -- <args>` is the front door. It ships in this repo, wraps the REST
API, and puts the guardrails in code instead of in prose you have to remember.

```bash
npm run gx -- --help              # every group
npm run gx -- codes --help        # the commands in one group
npm run gx -- codes add --help    # one command's arguments and flags
```

The `--` matters: it is what stops npm from eating the flags. `--help` is
generated from the command table (`src/lib/gx/registry.ts`), so it cannot drift
from what the commands actually do — **if `--help` and any file here disagree,
believe `--help`.** `--json` works on every command and prints the API's JSON
verbatim to stdout. Exit codes mean something: `0` the API answered 2xx, `1`
the API refused and its own message is on stderr, `2` a usage problem (unknown
command, missing argument, missing env var, refused localhost) — and on a `2`
**nothing was sent**, so nothing changed. Every mutating command prints
`→ POST http://…` to stderr before it writes, so the host being changed is
visible even if the command dies halfway. See `reference/cli.md` for the rest.

`curl` still works and is not deprecated — it is the escape hatch for anything
the CLI has no command for, and every reference file keeps its payload shapes
as `curl` invocations, because those are the payloads `gx` sends.

### Which server you are writing to

A server must be reachable, and every call is authenticated:

- `GAME_EXPLORER_URL` — **which collection you are writing to.** There is no
  default. The real collection lives on the Mac mini
  (`http://cids-Mac-mini.local:3000` on the wifi,
  `https://games.angelodipaolo.com` through the tunnel) and that is what "add
  this to my collection" always means. `http://localhost:3000` is a throwaway
  dev database: a write there looks like it succeeded and changes nothing the
  owner will ever see. **If `GAME_EXPLORER_URL` is unset, stop and ask which
  server** — never guess, and never fall back to localhost just because a dev
  server happens to answer on it.
- `GAME_EXPLORER_TOKEN` — one of the API tokens from the server's `.env`
  (`API_TOKENS`). **Every** `/api/*` call needs it; a call without one is a
  `401`.

Both are exported from the owner's `~/.zshenv`, which **every** zsh sources —
interactive, non-interactive and scripts alike — so they are already in your
environment. They are *not* in `.env`. Confirm before you start, and stop if
either is missing rather than inventing a value:

```bash
: "${GAME_EXPLORER_URL:?stop and ask the owner which server}"
: "${GAME_EXPLORER_TOKEN:?stop and ask the owner for an API token}"
```

`gx` reads both itself and exits `2` naming the one that is missing; it also
refuses a `localhost`, `127.0.0.x`, `::1` or `0.0.0.0` target unless `--dev` is
passed on that exact invocation. If you drop to `curl`, use
`"$GAME_EXPLORER_URL/api/..."` verbatim in every call and do not write a
`:-http://localhost:3000` fallback: an unset variable must break the command
loudly, not quietly retarget it at the wrong database.

If a call comes back `401 {"error":"unauthorized"}`, stop. Do not retry, and do
not fall back to writing to the database directly — say the token is missing or
wrong and let the owner fix it. A local dev server runs with `AUTH_OPEN=1` and
never returns `401`, so a clean `200` from localhost is **not** evidence that
you are talking to the right server.

## The capability map

Everything you can read or change, and how. "A copy" means one `ownedGameId` —
the NES Contra and the SNES Contra are two rows, and everything below hangs off
one of them.

| Data | Attaches to | Find it | Change it | CLI |
| --- | --- | --- | --- | --- |
| **Owned games** | the shelf itself | `GET /api/games?q=&platform=` · `GET /api/games/:id` | `PATCH /api/games/:id` — platform, quantity, condition, catalog link · `DELETE /api/games/:id` (no undo) · new ones only through import | `gx games search\|show\|update\|remove` |
| **Facts** | a copy | `GET /api/games/:id/facts` · `GET /api/enrichment/gaps` | `POST /api/enrichment/runs/:id/facts` — cited, inside a run. (`PUT /api/games/:id/facts` writes `source: "manual"`; that is the owner's hand-entry path, not yours) | `gx facts gaps\|list\|write` |
| **Tags** | a copy | `GET /api/games/:id/tags` · `GET /api/tags` (every spelling in use) | `POST /api/enrichment/runs/:id/tags` — cited, inside a run · `PUT`/`DELETE /api/games/:id/tags` for one by hand | `gx tags list\|on\|write\|add\|remove` |
| **Codes** | a copy | `GET /api/games/:id/codes` · `GET /api/codes/gaps` | `POST /api/codes` (batch, many copies) · `POST /api/games/:id/codes` (one) · `PATCH`/`DELETE /api/games/:id/codes/:codeId` | `gx codes gaps\|list\|add\|write\|update\|remove` |
| **Maps** | a copy | `GET /api/games/:id/maps` · `GET /api/maps/gaps` · `GET /api/maps/:mapId` | `POST /api/games/:id/maps` → `PUT /api/maps/:mapId/image` → `POST /api/maps/:mapId/markers` · `PATCH`/`DELETE /api/maps/:mapId` and `/api/maps/:mapId/markers/:markerId` | `gx maps gaps\|list\|create\|upload\|markers` (+ `show`, `update`, `remove`, `image`, `marker-*`) |
| **Bookmarks** | a copy | `GET /api/games/:id/bookmarks` · `GET /api/bookmarks/gaps` | `POST /api/bookmarks` (batch) · `POST /api/games/:id/bookmarks` (one) · `PATCH`/`DELETE /api/bookmarks/:bookmarkId` | `gx bookmarks gaps\|list\|add\|write\|update\|remove` |
| **Manuals** | a copy | `GET /api/games/:id/manuals` — **no gaps listing**: a scan cannot be looked up in bulk | `POST /api/games/:id/manuals` → `POST /api/manuals/:manualId/pages` → `PUT /api/manual-pages/:pageId/image` · `PATCH`/`DELETE /api/manuals/:manualId` and `/api/manual-pages/:pageId` | `gx manuals list\|create\|add-page\|upload\|reorder` (+ `update`, `remove`, `page-*`) |
| **Series** | **catalog IGDB ids**, not copies | `GET /api/series` · `GET /api/series/:seriesId` · `GET /api/series/collections` | `POST /api/series/seed-preview` → prune by hand → `POST /api/series` · `POST`/`PATCH`/`DELETE /api/series/:seriesId/entries` · `POST /api/series/:seriesId/seed-check` · `PATCH`/`DELETE /api/series/:seriesId` and `/api/series-entries/:entryId` | `gx series collections\|seed-preview\|create\|add-entries\|seed-check` (+ `list`, `show`, `reorder`, `remove-entries`, `update`, `remove`, `entry-*`) |
| **Runs / queue** | a copy (the queue is one global list) | `GET /api/games/:id/sessions` · `GET /api/sessions/open` · `GET /api/queue` | `POST /api/games/:id/sessions` · `PATCH`/`DELETE /api/sessions/:sessionId` · `POST`/`PATCH /api/queue` · `DELETE /api/queue/:ownedGameId` — **record, never infer** | `gx play list\|open\|start\|log\|finish\|edit\|remove` · `gx queue list\|add\|reorder\|remove` |
| **Journal** | a copy | `GET /api/games/:id/journal` | **never — the owner's, by design.** No agent write path, no `gx` command | — |
| **Music** | a copy | `GET /api/games/:id/music` (playable) · `GET /api/games/:id/music/all` (every row, uploaded or not) | `POST /api/games/:id/music` → `PUT /api/music/:trackId/audio` · `PATCH`/`DELETE /api/music/:trackId` — the owner's own files only | `gx music list\|all\|add\|upload\|retitle\|remove\|audio` |
| **Import** | — (the only way a game reaches the shelf) | `GET /api/import/sessions` · `GET /api/import/sessions/:id` · `GET /api/import/batches` | `POST /api/import/sessions` → `POST /api/import/sessions/:id/rows` → `PATCH /api/import/sessions/:id/rows/:rowId` → `POST /api/import/sessions/:id/commit` · `POST /api/import/csv` straight from a file · `POST /api/import/batches/:id/rollback` undoes one commit exactly · `DELETE /api/import/sessions/:id` discards an unfinished one | `gx import create\|csv\|add-rows\|show\|decide\|commit\|rollback` (+ `sessions`, `batches`, `discard`) |
| **Enrichment runs** | — (the unit cited facts and tags are written inside) | `GET /api/enrichment/runs` · `GET /api/enrichment/runs/:id` | `POST /api/enrichment/runs` … `POST /api/enrichment/runs/:id/finish` | `gx enrichment start\|show\|finish\|runs` |

Where a CLI cell is trimmed, `gx <group> --help` has the rest — it is generated
from the same table the commands run on, so it is never behind this file.

Two routes have no command and never will: `/api/auth/*` is the owner's browser
session, and `/api/img/*` is the shelf's pixels. Their absence from `--help` is
deliberate, not an oversight.

## Finding what to act on

Most requests name a game rather than an id, and nothing else in this map works
until a name is an `ownedGameId`. There is no single right way in — pick the
entry point the request actually gives you:

- **A name.** `gx games search "super metroid" --json` — `GET /api/games?q=` is
  the only route that enumerates the shelf. Every row carries both ids:
  `ownedGameId` for anything hung off a copy, `igdbId` for series entries.
  Drop a *word* if a search comes up empty (`q=zelda` beats the full subtitle);
  read the names back rather than trusting the first hit.
- **A platform, or the whole shelf.** `gx games search --platform nes
  --limit 200` — `platform` is repeatable and takes aliases. This is the entry
  point for "all NES games that…".
- **A `gaps` listing**, when the request really is "work through what is
  missing": `gx codes gaps`, `gx bookmarks gaps`, `gx maps gaps`,
  `gx facts gaps`. These list copies **missing** one kind of data, so they are
  a work queue and not a search. Reaching for `maps gaps` to find one named
  game is backwards, and if that game already has a map it will not be in the
  list at all.
- **A photo, a CSV, a spreadsheet, a list.** Nothing to look up: that is an
  import (`reference/games.md`), and the ids come out the other end.
- **An id the owner already gave you.** Use it. Do not re-derive it.

Whatever the entry point, `gx games show <ownedGameId>` before you write:
`counts` says how many codes, maps, bookmarks, manuals, tags and tracks are
already there. Research nobody needed is the most expensive thing you can do
here.

## The rules that bind

Each of these exists because breaking it does real damage, and most of the
damage is invisible at the moment it happens.

**Never the local database.** Not `prisma/dev.db`, not Prisma directly, not a
`localhost` fallback when `GAME_EXPLORER_URL` is unset. A write to the wrong
database returns a clean `200` and changes nothing the owner will ever see —
the failure has no symptom until they go looking for the game on their shelf.

**Per copy, not per title.** Codes, maps, bookmarks, manuals, music, runs and
queue entries all attach to an `ownedGameId`. The NES and SNES versions of one
game are different rows on purpose: Game Genie codes differ per platform, a
SNES walkthrough is the wrong walkthrough for the cartridge on the shelf, and
the two soundtracks are genuinely different music. Series are the exception
that proves it — series membership is **catalog IGDB ids**, because a series
lists games whether or not you own them.

**An ambiguous target is a question, not a coin flip.** If a search for
"Contra" returns two copies, a **write** must not pick one — say what you found
and ask which. The wrong-copy write is the same failure class as the localhost
bug: it succeeds, it is real data, and nobody notices for months. A **read**
may pick the best match and act on it, as long as you say which one you chose.

**Cite or link; never author.** Every domain here keys "trustworthy" off a
citation you could hand the owner, not off your own confidence. Facts and tags
need a `sourceUrl` per claim and the API rejects agent writes without one; a
bookmark **is** its own citation, which is why it has no `sourceUrl` and why it
carries a required `why` line instead. There is no "walkthrough" or "blurb"
field anywhere in this API on purpose: a prose guide has no citation
granularity, and this project refuses to produce one. Link the real guide, cite
the real page, write the fact with its source — never summarize or narrate.
Leave a field null, or a game empty, rather than guess: a game with no codes is
honest, a game with plausible-looking wrong ones is worse than nothing.

**Music is the one domain where you do not even source.** The files are the
owner's own, handed to you in the conversation; you never download, rip,
convert or generate audio, and you never go looking through their music
library. "I have no file in hand" is the correct outcome, not a failed search.
See `reference/music.md`.

**Manual facts and hand-set tags are never overwritten.** Precedence is
`manual > agent > igdb`, the API enforces it, and it *skips* the write rather
than erroring — so on any batch write, **read `skipped` and its `reason`.**
Partial success is normal there; a batch that reports nothing skipped and a
batch that silently dropped half its rows look identical if you do not look.
Codes, maps, bookmarks, manuals, series and music tracks are the deliberate
exception: they are lists, not contested values, so none of those tables has a
`source` column or any precedence at all. What you write and what the owner
types by hand are the same kind of row, rendered identically, editable by
either side — so the only thing keeping those sections useful is your judgement
about what belongs in them.

**Stop on a 401.** It means the token is missing or wrong. Do not retry it, do
not try another host, do not route around it into the database. Say so and let
the owner fix it.

**Record, never infer, for play state.** An agent may write down a run the
owner described — "I finished Contra last night" is dictation. It must never
derive one from a habit, a journal entry, a bookmark date or a completion
percentage, and "mark everything on the NES shelf as played" is that same
fabrication at scale. If a date was not stated, ask or record it `undated`;
never pick a plausible year. A wrong tag is visibly wrong on the page and gets
deleted; a fabricated run is indistinguishable from a remembered one forever.
Read `reference/play.md` before touching either runs or the queue.

**Report what you actually did.** Say what you looked at, what you wrote and
where each claim came from, what you deliberately left blank and why, and
anything the API skipped or rejected. Never report a row you did not write.

### Never write these

**The journal** — `/api/games/[id]/journal`, `/api/journal/*`
(`/api/journal/[entryId]`, `/api/journal/[entryId]/image`) — has **no agent
write path by design** (GAMEEXPLOR-0009, reaffirmed by GAMEEXPLOR-0031). No
batch endpoint, no `gaps` route, no `gx` command. If asked to write a journal
note or add a journal photo, **refuse and say why**.

The reason, which is worth keeping straight because it is what separates this
from everything else in the capability map: codes, maps and bookmarks share one
API between the owner and a research skill because they are public facts about
a game, checkable by anyone. Journal entries are not. Notes and photos are
prose about the owner's own life, nobody but them can produce a playthrough's
writing, and an agent drafting one is the same failure as an agent-written
walkthrough — no citation granularity, and undetectable as invention after the
fact. There is no dictation shape for it either: a run has a date and an
outcome to be told, a journal entry is the writing itself.

Play sessions and the queue were on this list too until GAMEEXPLOR-0031, which
opened both under **record, never infer** above. The journal never opens.

Also **`/api/auth/*`** (`/api/auth/login`, `/api/auth/logout`) is not for
agents — it is how the owner's browser session is established, not a curation
endpoint.

If a request sounds like the journal ("write up my session", "add a journal
photo"), say plainly that this app has no agent write path for it and that it
is the owner's to add by hand.

## Reference files

Payload shapes, field-by-field meaning, caps, refusals and the per-domain
judgement calls. Open the one that covers the data you are touching — each is
self-contained.

| File | What it covers |
| --- | --- |
| `reference/cli.md` | `gx` itself: running it, the guardrails in its code, `--json`, exit codes, batch bodies, a worked name → id → write example |
| `reference/games.md` | Finding a copy, reading it, correcting it, deleting it — and the staged import in full |
| `reference/facts.md` | The player and playtime fields, why co-op is three of them, runs and citations |
| `reference/tags.md` | What to tag and what not to, reusing spellings, hiding an IGDB tag |
| `reference/codes.md` | The four kinds, what goes in `effect` vs `howTo`, the 30-code cap |
| `reference/maps.md` | Reading coordinates out of an image, the ten marker kinds, crop-before-you-read |
| `reference/bookmarks.md` | The five kinds, the required `why`, verifying a link resolves, batch schema failure |
| `reference/manuals.md` | Row-then-bytes uploads, dense page positions, reordering as a permutation |
| `reference/series.md` | Seed → prune → save, `seenIgdbIds`, sections, checking for what is new |
| `reference/music.md` | Owner-supplied MP3s only, row-then-bytes, the 60-track cap, verifying playback |
| `reference/play.md` | Runs and the queue: record-never-infer in full, dates without timezone maths, every refusal |
