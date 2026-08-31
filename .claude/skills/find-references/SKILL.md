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

The dev server must be running (`http://localhost:3000`).

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
curl -s 'localhost:3000/api/bookmarks/gaps?limit=50'
curl -s 'localhost:3000/api/bookmarks/gaps?kinds=guide,longplay&limit=50'
# → { total, gaps: [{ ownedGameId, title, name, platform, year, igdbId, have }] }
# `have` is what that copy already holds per kind — don't redo it.

# Research, verify each link resolves, then write across as many games as you
# like in one request
curl -s -X POST localhost:3000/api/bookmarks -H 'content-type: application/json' -d '{
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
