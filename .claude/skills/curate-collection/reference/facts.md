# Enrichment facts

See `SKILL.md` for the env/auth preamble — do not skip it.

IGDB knows co-op yes/no for most of the shelf but exact player counts for only
a fifth, and it does not model "at the same time vs. taking turns" at all. This
domain fills those gaps from the web, one cited fact at a time.

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
curl -s -H "Authorization: Bearer $GAME_EXPLORER_TOKEN" "$GAME_EXPLORER_URL/api/enrichment/gaps?fields=maxPlayers,simultaneousPlay&limit=25"
# → { total, gaps: [{ ownedGameId, title, name, platform, year, igdbId, missing, known }] }

# 2. Start a run
curl -s -H "Authorization: Bearer $GAME_EXPLORER_TOKEN" -X POST "$GAME_EXPLORER_URL/api/enrichment/runs" -H 'content-type: application/json' -d '{"label":"players pass 1"}'
# → { id: <runId> }
# GET /api/enrichment/runs lists past runs; GET /api/enrichment/runs/<runId> reads one's report.

# 3. Research each game (web search: "<name> NES players", the manual, a wiki),
#    then write what you found — batches are fine.
curl -s -H "Authorization: Bearer $GAME_EXPLORER_TOKEN" -X POST "$GAME_EXPLORER_URL/api/enrichment/runs/<runId>/facts" -H 'content-type: application/json' -d '{
  "facts": [
    { "ownedGameId": "…", "field": "maxPlayers", "value": 2, "sourceUrl": "https://…", "note": "manual p.4: 1 or 2 players, alternating" },
    { "ownedGameId": "…", "field": "simultaneousPlay", "value": false, "sourceUrl": "https://…" }
  ]
}'
# → { written: [...], skipped: [{ ownedGameId, field, reason }] }
# skipped reasons: "no sourceUrl — agent facts must cite a source",
# "owned game not found", "set by hand; agents never overwrite manual facts".

# 4. Finish, and read the report back to the user
curl -s -H "Authorization: Bearer $GAME_EXPLORER_TOKEN" -X POST "$GAME_EXPLORER_URL/api/enrichment/runs/<runId>/finish"
# → { factsWritten, gamesTouched, byField, ... }
```

Work in batches of ~25 games. Use `known` in the gaps response so you do not
re-research what IGDB already covers; `known.multiplayer: false` means the
game is single player and `maxPlayers` is 1 by derivation — skip it.

A fact posted through a run always lands with `source: "agent"`. There is a
separate, owner-facing pair — `GET`/`PUT /api/games/:id/facts { field, value,
note? }` — that writes `source: "manual"` (a `null` value clears the fact);
**that endpoint is the owner's hand-entry path, not yours** — using it would
make your research masquerade as a manual, unoverridable value. Always write
through a run's `/facts` endpoint instead, even for a single game.

## Report

Say: how many games you looked at, how many facts you wrote (by field), which
games you could not find a source for (left null), and anything skipped
because a manual fact already existed. In the UI these facts show as
**researched** with the citation on hover, distinct from IGDB and from
**verified** (hand-set) values.
