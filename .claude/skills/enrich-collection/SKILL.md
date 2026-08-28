---
name: enrich-collection
description: Fill gaps IGDB leaves in Game Explorer's collection — exact player counts, whether players play at the same time or take turns, co-op, playtime — by researching each game and writing cited facts back through the enrichment API. Use when asked to "fill in player counts", "enrich the collection", "find out which games are 2-player simultaneous", or "work through the gaps".
---

# Enrich the collection

IGDB knows co-op yes/no for most of the shelf but exact player counts for only
a fifth, and it does not model "at the same time vs. taking turns" at all. This
skill fills those gaps from the web, one cited fact at a time.

The dev server must be running (`http://localhost:3000`).

## Rules

1. **Cite a source per claim.** Every fact needs a `sourceUrl` the user could
   open — a manual scan, a wiki page, a publisher page, a review that states
   the number. The API rejects agent facts without one.
2. **Leave a field null rather than guess.** No source, no fact. "Most NES
   sports games are 2-player" is not a source.
3. **Never overwrite a manual fact.** The API enforces this; do not try to
   route around it. If you think a manual value is wrong, tell the user.
4. **Prefer the cartridge's release**, not a remake or a later port.
5. **One run per session** so the report is meaningful.

## Fields

| field | type | meaning |
| --- | --- | --- |
| `maxPlayers` | int | most people who can play in one session |
| `simultaneousPlay` | bool | true = together at once; false = alternating turns |
| `coop` | bool | players cooperate (vs. only versus / alternating) |
| `coopMaxPlayers` | int | most people in co-op at once |
| `splitscreen` | bool | |
| `singlePlayer` / `multiplayer` | bool | rarely needed; IGDB covers these |
| `playtimeMinutes` | int | typical time to finish once |

`simultaneousPlay` is the one that matters most: it is what makes "2-player
co-op" filterable.

## Path

```bash
# 1. What is missing? (default fields: maxPlayers, simultaneousPlay, coop)
curl -s 'localhost:3000/api/enrichment/gaps?fields=maxPlayers,simultaneousPlay&limit=25'
# → { total, gaps: [{ ownedGameId, title, name, platform, year, igdbId, missing, known }] }

# 2. Start a run
curl -s -X POST localhost:3000/api/enrichment/runs -H 'content-type: application/json' -d '{"label":"players pass 1"}'
# → { id: <runId> }

# 3. Research each game (web search: "<name> NES players", the manual, a wiki),
#    then write what you found — batches are fine.
curl -s -X POST localhost:3000/api/enrichment/runs/<runId>/facts -H 'content-type: application/json' -d '{
  "facts": [
    { "ownedGameId": "…", "field": "maxPlayers", "value": 2, "sourceUrl": "https://…", "note": "manual p.4: 1 or 2 players, alternating" },
    { "ownedGameId": "…", "field": "simultaneousPlay", "value": false, "sourceUrl": "https://…" }
  ]
}'
# → { written: [...], skipped: [{ ownedGameId, field, reason }] }

# 4. Finish, and read the report back to the user
curl -s -X POST localhost:3000/api/enrichment/runs/<runId>/finish
# → { factsWritten, gamesTouched, byField, ... }
```

Work in batches of ~25 games. Use `known` in the gaps response so you do not
re-research what IGDB already covers; `known.multiplayer: false` means the
game is single player and `maxPlayers` is 1 by derivation — skip it.

## Report

Say: how many games you looked at, how many facts you wrote (by field), which
games you could not find a source for (left null), and anything skipped
because a manual fact already existed. In the UI these facts show as
**researched** with the citation on hover, distinct from IGDB and from
**verified** (hand-set) values.
