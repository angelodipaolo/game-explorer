# Tags

See `SKILL.md` for the env/auth preamble — do not skip it.

Tags sit on top of IGDB's genres / perspectives / themes. Yours and an agent's
are added; IGDB's can only be hidden. In filters they are one pool, so a tag
you add is filterable the moment it exists (`/?tags=Metroidvania`).

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
# What is on the shelf (id, name, platform). There is no tags `gaps` route —
# "untagged" is not a gap, because IGDB already tags most of the shelf.
npm run gx -- games search --platform nes --limit 200 --json
curl -s -H "Authorization: Bearer $GAME_EXPLORER_TOKEN" "$GAME_EXPLORER_URL/api/games?platform=nes&limit=200"

# Every tag already in use, with counts — read it before inventing a spelling
npm run gx -- tags list --json
curl -s -H "Authorization: Bearer $GAME_EXPLORER_TOKEN" "$GAME_EXPLORER_URL/api/tags"

# One copy's current tags (manual, agent, IGDB's, and which are hidden)
npm run gx -- tags on <ownedGameId>

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

For one game by hand: `GET /api/games/:id/tags` lists a copy's tags; `PUT
/api/games/:id/tags { "tag": "Metroidvania", "note"? }` adds a hand-set tag;
`DELETE` with the same body removes your/agent tag; hide an IGDB tag with
`PUT`/`DELETE` `{ "tag": "Shooter", "igdb": true }` — `DELETE` hides it,
`PUT` un-hides it.

## Report

Say how many games you looked at, which tags you added and to how many games
each, what you skipped (manual tag already there, no source), and the run id.
In the UI, agent tags are blue with a ↗ to the citation; hand-set ones are
green; IGDB's are grey.
