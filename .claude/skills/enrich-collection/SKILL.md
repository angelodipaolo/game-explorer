---
name: enrich-collection
description: Fill gaps IGDB leaves in Game Explorer's collection — exact player counts, whether players play at the same time or take turns, co-op, playtime — by researching each game and writing cited facts back through the enrichment API. Use when asked to "fill in player counts", "enrich the collection", "find out which games are 2-player simultaneous", or "work through the gaps".
---

# Enrich the collection

IGDB knows co-op yes/no for most of the shelf but exact player counts for only
a fifth, and it does not model "at the same time vs. taking turns" at all. This
skill fills those gaps from the web, one cited fact at a time.

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

The app describes a game on three independent axes — how many players, which
kind of co-op, and whether they play together or take turns
(`src/lib/players.ts`). These fields are what feed them.

| field | type | meaning |
| --- | --- | --- |
| `maxPlayers` | int | most people who can play in one session |
| `simultaneousPlay` | bool | true = together at once ("Together"); false = alternating turns ("Taking turns") |
| `coop` | bool | **local** co-op: couch, same console, split screen |
| `onlineCoop` | bool | **remote** co-op over a network. IGDB never says; this is yours to find |
| `coopMaxPlayers` | int | most people in co-op at once |
| `splitscreen` | bool | a local-co-op signal; `coop` is the one to write |
| `singlePlayer` / `multiplayer` | bool | rarely needed; IGDB covers these |
| `playtimeMinutes` | int | typical time to finish once |

**Local and online co-op are two different fields, on purpose.** Every player
column IGDB gives us describes one couch, so `coop` is the local kind and
`onlineCoop` starts unknown on every game in the collection — it exists so you
can fill it in. A game with both gets both set to true. Most cartridges on this
shelf have no online anything: write `onlineCoop: false` only when a source
says so, and otherwise leave it null rather than assuming.

`simultaneousPlay` is the one that matters most: it is what makes "2 of us, at
the same time" filterable. Super Mario Kart is 1–2 simultaneous; Donkey Kong
Country is 1–2 taking turns.

## Path

```bash
# 1. What is missing? (default fields: maxPlayers, simultaneousPlay, coop)
#    `onlineCoop` is unknown on every game, so ask for it only on a pass that
#    is actually about online play — otherwise it returns the whole shelf.
curl -s -H "Authorization: Bearer $GAME_EXPLORER_TOKEN" "$GAME_EXPLORER_URL/api/enrichment/gaps?fields=maxPlayers,simultaneousPlay&limit=25"
# → { total, gaps: [{ ownedGameId, title, name, platform, year, igdbId, missing, known }] }

# 2. Start a run
curl -s -H "Authorization: Bearer $GAME_EXPLORER_TOKEN" -X POST "$GAME_EXPLORER_URL/api/enrichment/runs" -H 'content-type: application/json' -d '{"label":"players pass 1"}'
# → { id: <runId> }

# 3. Research each game (web search: "<name> NES players", the manual, a wiki),
#    then write what you found — batches are fine.
curl -s -H "Authorization: Bearer $GAME_EXPLORER_TOKEN" -X POST "$GAME_EXPLORER_URL/api/enrichment/runs/<runId>/facts" -H 'content-type: application/json' -d '{
  "facts": [
    { "ownedGameId": "…", "field": "maxPlayers", "value": 2, "sourceUrl": "https://…", "note": "manual p.4: 1 or 2 players, alternating" },
    { "ownedGameId": "…", "field": "simultaneousPlay", "value": false, "sourceUrl": "https://…" },
    { "ownedGameId": "…", "field": "onlineCoop", "value": true, "sourceUrl": "https://…", "note": "Xbox Live co-op campaign" }
  ]
}'
# → { written: [...], skipped: [{ ownedGameId, field, reason }] }

# 4. Finish, and read the report back to the user
curl -s -H "Authorization: Bearer $GAME_EXPLORER_TOKEN" -X POST "$GAME_EXPLORER_URL/api/enrichment/runs/<runId>/finish"
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
