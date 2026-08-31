---
name: find-references
description: Research and record reference links — guides, wikis, longplays, articles — for games in Game Explorer, one line saying why each one, through the bookmarks API. Use when asked to "find guides for my games", "add the GameFAQs walkthrough", "fill in the wiki links", "find longplays", or to bookmark a page for one game.
---

# Find reference links for the collection

Bookmarks live on an owned **copy**, not on a title: the NES and SNES versions
of one game get separate links, because a walkthrough for the SNES release is
the wrong walkthrough for the cartridge on the shelf. Always write to the
`ownedGameId` the gaps endpoint gave you.

There is no notion of who wrote a bookmark. Whatever you record is the same
kind of record as a link the owner pasted in on the game page, rendered
identically, and editable and deletable by them. Nothing you write outranks
anything, and nothing they wrote blocks you — so the only thing keeping the
section useful is your judgement about what to put in it.

**Every bookmark is its own citation.** There is no `sourceUrl` field here
because the `url` *is* the source: the point of this table is to link the real
GameFAQs guide, not to summarise it. Which is also the line you must not
cross — **you do not write game guides**. A prose walkthrough authored by an
agent is a wall of plausible text with no citation granularity, and this
project refuses to produce one. Find the guide. Link the guide.

IGDB has nothing usable here: `games.websites` occasionally links an official
site or a wiki, which is a lead worth following, never an answer to paste in.

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

Both are exported from the owner's `~/.zshrc`, which a **non-interactive shell
does not source** — and an agent's shell is non-interactive, so they are
usually absent unless you load them. Start every session with:

```bash
set -a; . ~/.zshrc >/dev/null 2>&1; set +a   # the exports live here, not in .env
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

## The five kinds

| `kind` | What belongs in it |
| --- | --- |
| `guide` | A walkthrough or FAQ that gets you through the game — GameFAQs, StrategyWiki, a good fan guide |
| `wiki` | A reference you look things up in: item lists, damage tables, maps, a fan wiki |
| `video` | A specific video that shows one thing: a boss, a trick, a speedrun segment |
| `longplay` | A start-to-finish playthrough, usually commentary-free — World of Longplays and the like |
| `article` | Reading about the game rather than help with it: a retrospective, a making-of, an interview |

Anything that fits two goes under the one you would open it *for*.

## What goes in which field

- **`url`** — the page itself. `http`/`https` only; anything else is rejected.
  Link the page, not a search result and not the site's front door.
- **`title`** — what the page calls itself, including the author when a guide
  has one: "Contra — FAQ/Walkthrough by CyricZ". Required.
- **`why`** — one line: what makes this the link to open rather than the other
  nine hits. "Covers the NES release stage by stage, with the 30-lives code up
  front." **Required, and the entire point of the table** — a list of bare URLs
  is a bookmarks folder nobody opens twice. Write it as you would say it to
  someone holding the controller.
- **`note`** — anything else worth knowing: it covers the Japanese version too,
  it is paywalled after a few reads, the video has a chapter list.

## Rules

1. **Verify every link resolves before you write it.** Fetch it. A 404, a
   parked domain, or a page that redirects to a site's home page is worse than
   no bookmark, because it looks like one that works. Dead GameFAQs and
   fan-wiki URLs from years ago are common.
2. **Check the page is about this game and this platform.** A guide indexed
   under the arcade or Virtual Console release is usually the wrong one for the
   cartridge on the shelf.
3. **A shortlist, not a link dump.** Aim for 2–6 per game: the best guide, a
   wiki if a good one exists, a longplay if one exists. The cap is 50 and the
   API skips past it; nobody scrolls 50 links on a phone.
4. **Never write a `why` you cannot support from the page itself.** If you
   could not tell what makes it good, you have not read enough of it to
   bookmark it.
5. **Bookmarks are per copy.** Use the `ownedGameId` from the gaps response,
   never a title.
6. **Leave a game empty rather than guess.** A game with no links is honest; a
   game with a plausible-looking dead one is worse than nothing.
7. **Do not write a guide.** Not in `why`, not in `note`, not anywhere. If no
   good guide exists for a game, that is the finding — report it.

## Path

```bash
# Copies with no bookmarks at all (or none of a kind)
curl -s -H "Authorization: Bearer $GAME_EXPLORER_TOKEN" "$GAME_EXPLORER_URL/api/bookmarks/gaps?limit=50"
curl -s -H "Authorization: Bearer $GAME_EXPLORER_TOKEN" "$GAME_EXPLORER_URL/api/bookmarks/gaps?kinds=guide,longplay&limit=50"
# → { total, gaps: [{ ownedGameId, title, name, platform, year, igdbId, have }] }
# `have` is what that copy already holds per kind — don't redo it.

# Research, verify each link resolves, then write across as many games as you
# like in one request
curl -s -H "Authorization: Bearer $GAME_EXPLORER_TOKEN" -X POST "$GAME_EXPLORER_URL/api/bookmarks" -H 'content-type: application/json' -d '{
  "bookmarks": [
    { "ownedGameId": "…", "kind": "guide",
      "url": "https://gamefaqs.gamespot.com/nes/563406-contra/faqs/1",
      "title": "Contra — FAQ/Walkthrough by CyricZ",
      "why": "Covers the NES release stage by stage, with the 30-lives code up front" },
    { "ownedGameId": "…", "kind": "longplay",
      "url": "https://www.youtube.com/watch?v=…",
      "title": "NES Longplay — Contra",
      "why": "One-life run, no commentary, so you can see the stage layouts",
      "note": "Chapter markers per stage." }
  ]
}'
# → { written: [...], skipped: [{ ownedGameId, kind, title, reason }] }
```

Partial success is normal: a bad entry is skipped with a reason and the rest
still land. Read `skipped` — the reasons are "unknown kind", "owned game not
found", and "already at the 50-bookmark limit".

**But partial success only covers those three.** A `url` that is not a
parseable `http`/`https` address, or a missing/blank `why` or `title`, fails
*schema validation* — the request comes back `400 invalid input` and **not one
row of the batch is written**. So before you POST a batch of 200, check that
every `url` parses and every entry carries a `why`; otherwise one typo costs
you the whole pass. A 400 lists the offending indexes in `details`.

Writing the same URL twice for one copy refreshes that row rather than
stacking a duplicate; the key ignores `http`/`https`, `www.`, a trailing slash,
the fragment and tracking query, and sorts the query — so a re-run is
idempotent. It does **not** fold case in the path or query, because
`/wiki/Contra` and `/wiki/contra` are genuinely different pages.

For one game by hand: `POST /api/games/:id/bookmarks` with the same body minus
`ownedGameId`; `PATCH /api/bookmarks/:bookmarkId` to edit; `DELETE` the same
path to remove. `GET /api/games/:id/bookmarks` lists a copy's set.

## Report

Say how many copies you looked at, how many links you wrote and to how many
games, which games you deliberately left empty and why, which candidate links
you rejected because they did not resolve or were for the wrong release, and
anything the API skipped with its reason. Bookmarks appear on `/game/<id>`
under **Guides & links**, grouped by kind, each opening in a new tab.
