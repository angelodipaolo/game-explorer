---
name: tag-collection
description: Tag and categorise games in Game Explorer — add descriptive tags like "Metroidvania", "roguelike", "couch co-op", "party game" across the collection, with a cited source per tag, through the tags API. Use when asked to "tag my collection", "categorise these games", "which of my games are metroidvanias", or to add a tag to one game.
---

# Tag the collection

Tags sit on top of IGDB's genres / perspectives / themes. Yours and an agent's
are added; IGDB's can only be hidden. In filters they are one pool, so a tag
you add is filterable the moment it exists (`/?tags=Metroidvania`).

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

## Rules

1. **Cite a source per tag** (`sourceUrl`) — a wiki page, a store page, a
   review that uses the word. The API rejects agent tags without one.
2. **Never override a hand-set tag.** The API skips agent tags where a manual
   one with the same key exists; do not work around it.
3. **Reuse existing spellings.** `GET /api/tags` lists every tag in use with
   counts. Prefer "Metroidvania" over inventing "metroid-vania".
4. **Tag what the game *is*, not what it has.** Good: Metroidvania, roguelike,
   couch co-op, party game, JRPG, shmup, rhythm, kart racer, licensed,
   compilation. Bad: "fun", "hard", "1990s" (era is already a filter).
5. Leave a game untagged rather than guess.

## Path

```bash
# What is on the shelf (id, name, platform, current tags)
curl -s -H "Authorization: Bearer $GAME_EXPLORER_TOKEN" "$GAME_EXPLORER_URL/api/enrichment/gaps?fields=maxPlayers&limit=500"   # ids + names; or read data/snapshot.json
curl -s -H "Authorization: Bearer $GAME_EXPLORER_TOKEN" "$GAME_EXPLORER_URL/api/tags"                                            # tags already in use

# One run per session so the report is meaningful
curl -s -H "Authorization: Bearer $GAME_EXPLORER_TOKEN" -X POST "$GAME_EXPLORER_URL/api/enrichment/runs" -H 'content-type: application/json' -d '{"label":"metroidvania pass"}'
# → { id: <runId> }

# Write tags in batches
curl -s -H "Authorization: Bearer $GAME_EXPLORER_TOKEN" -X POST "$GAME_EXPLORER_URL/api/enrichment/runs/<runId>/tags" -H 'content-type: application/json' -d '{
  "tags": [
    { "ownedGameId": "…", "tag": "Metroidvania", "sourceUrl": "https://en.wikipedia.org/wiki/Metroidvania", "note": "listed as a defining example" }
  ]
}'
# → { written: [...], skipped: [{ ownedGameId, tag, reason }] }

curl -s -H "Authorization: Bearer $GAME_EXPLORER_TOKEN" -X POST "$GAME_EXPLORER_URL/api/enrichment/runs/<runId>/finish"
```

For one game by hand: `PUT /api/games/:id/tags { "tag": "Metroidvania" }`;
remove with `DELETE` and the same body; hide an IGDB tag with
`{ "tag": "Shooter", "igdb": true }` on `DELETE`, un-hide with the same body on `PUT`.

## Report

Say how many games you looked at, which tags you added and to how many games
each, what you skipped (manual tag already there, no source), and the run id.
In the UI, agent tags are blue with a ↗ to the citation; hand-set ones are
green; IGDB's are grey.
