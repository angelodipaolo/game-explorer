---
name: curate-collection
description: Curate and enrich Game Explorer's collection through its write API — the one skill for every research and data-entry task on the shelf. Use when asked to import or add games (a CSV, spreadsheet, list, or shelf photo), tag or categorise games ("Metroidvania", "roguelike", "couch co-op"), fill in player counts / co-op / simultaneous-play / playtime facts, find or add Game Genie / Action Replay / password / cheat codes, build interactive maps with markers, find or add reference links (guides, wikis, longplays, articles), scan or organize manuals, register the owner's own soundtrack files as background music for a game, or seed/prune/edit a series. Also covers "work through the gaps", "enrich the collection", "fill in what's missing", and single-game edits like "add a code to this game", "bookmark a guide for this game" or "add music for this game", or record play state the owner reports ("mark Contra as playing", "I finished this last night", "queue these three up next" — never the journal).
---

# Curate the collection

Game Explorer has one write API behind every curation task: importing games,
enrichment facts, tags, codes, maps, bookmarks, manuals, series, music, and the
play state the owner reports.
This skill is the entry point for all of it. Read the routing table below, then
open the one reference file that covers the task at hand — each reference
file is self-contained on payload shapes and gotchas for its domain.

You are the smart client throughout: the API owns validation, matching,
precedence and the transaction; you own research, judgement, and citations.

## Which server you are writing to

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

Then use `"$GAME_EXPLORER_URL/api/..."` verbatim in every call. Do not write a
`:-http://localhost:3000` fallback: an unset variable must break the command
loudly, not quietly retarget it at the wrong database.

If a call comes back `401 {"error":"unauthorized"}`, stop. Do not retry, and do
not fall back to writing to the database directly — say the token is missing or
wrong and let the owner fix it. A local dev server runs with `AUTH_OPEN=1` and
never returns `401`, so a clean `200` from localhost is **not** evidence that
you are talking to the right server.

## The working loop

Every domain below follows the same shape:

1. **Find the gaps.** Most domains expose a `gaps` (or equivalent listing)
   endpoint that tells you what is missing and gives you the id to write to.
   Read it before researching anything.
2. **Research.** The web, a manual scan, a wiki, a store page — whatever the
   domain's reference file says counts as a real source.
3. **Cite.** Every domain here keys "trustworthy" off a citation you could
   hand the owner, not off your own confidence.
4. **Write via the API**, never around it. Batches where the domain supports
   them; partial success is normal — read `skipped`/`reason` and keep going.
5. **Report.** Say what you looked at, what you wrote and where each claim
   came from, what you deliberately left blank and why, and anything the API
   rejected.

**Agents research and source material; they never author it.** Every domain
here is either a cited fact (a source URL a person could open) or a link to
someone else's real page — never agent-written prose. There is no "walkthrough"
or "blurb" field anywhere in this API on purpose: a prose guide has no citation
granularity, and this project refuses to produce one. Link the real guide, cite
the real page, write the fact with its source — never summarize or narrate.

**Music is the one domain where you do not even source.** The files are the
owner's own, handed to you in the conversation; you never download, rip,
convert or generate audio, and you never go looking through their music
library. See `reference/music.md`.

**Precedence, once, for the whole app:** manual facts and hand-set tags are
never overwritten by IGDB sync or by an agent — the API enforces this and
skips the write rather than erroring, so read `skipped` to see it happen.
Codes, maps, bookmarks, manuals, series and music tracks are the deliberate
exception: they are lists, not contested values, so none of those tables has a
`source` column or any precedence at all. What you write there and what the owner types by
hand are the same kind of row, rendered identically, editable by either side —
so the only thing keeping any of those sections useful is your judgement about
what belongs in it.

## Routing table

| Task | Reference file |
| --- | --- |
| **Driving any of these from the command line** — `npm run gx -- --help` | `reference/cli.md` |
| Import games from a CSV, spreadsheet, list, or shelf photo | `reference/games.md` |
| Player counts, co-op, simultaneous play, splitscreen, playtime | `reference/facts.md` |
| Tags / genres like "Metroidvania", "roguelike", "couch co-op" | `reference/tags.md` |
| Passwords, cheats, Game Genie, Action Replay / GameShark codes | `reference/codes.md` |
| Interactive maps (overworld/dungeon images + tappable markers) | `reference/maps.md` |
| Reference links: guides, wikis, videos, longplays, articles | `reference/bookmarks.md` |
| Scanned manuals: pages, reordering, page images | `reference/manuals.md` |
| Series: seeding from an IGDB collection, pruning, editing | `reference/series.md` |
| Background music: registering owner-supplied soundtrack tracks | `reference/music.md` |
| Play state: a run the owner reports, and the up-next queue | `reference/play.md` |

## Never write these

**The journal** — `/api/games/[id]/journal`, `/api/journal/*`
(`/api/journal/[entryId]`, `/api/journal/[entryId]/image`) — has **no agent
write path by design** (GAMEEXPLOR-0009, reaffirmed by GAMEEXPLOR-0031). No
batch endpoint, no `gaps` route, no `gx` command. If asked to write a journal
note or add a journal photo, **refuse and say why**.

The reason, which is worth keeping straight because it is what separates this
from everything else in the routing table: codes, maps and bookmarks share one
API between the owner and a research skill because they are public facts about
a game, checkable by anyone. Journal entries are not. Notes and photos are
prose about the owner's own life, nobody but them can produce a playthrough's
writing, and an agent drafting one is the same failure as an agent-written
walkthrough — no citation granularity, and undetectable as invention after the
fact. There is no dictation shape for it either: a run has a date and an
outcome to be told, a journal entry is the writing itself.

Play sessions and the queue were on this list too until GAMEEXPLOR-0031, which
opened both under one rule — **record, never infer**: write down a run the
owner described, never one you deduced. See `reference/play.md` before you
touch either; the rule and its refusals are stated there in full.

Also **`/api/auth/*`** (`/api/auth/login`, `/api/auth/logout`) is not for
agents — it is how the owner's browser session is established, not a curation
endpoint.

If a request sounds like the journal ("write up my session", "add a journal
photo"), say plainly that this app has no agent write path for it and that it
is the owner's to add by hand.
