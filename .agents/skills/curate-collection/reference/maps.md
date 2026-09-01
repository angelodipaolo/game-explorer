# Maps

See `SKILL.md` for the env/auth preamble — do not skip it.

A map is **one image plus a list of markers in that image's pixel
coordinates**. The app does the rest: pan, pinch-zoom, tap a marker for its
note, tap a list entry to fly to it. Your job is the data: a good image, and
accurate, well-named markers.

Maps attach to an owned **copy** (`ownedGameId`), like codes. A game with
several worlds (overworld / underworld / moon; light world / dark world) gets
several maps on the same copy, each with its own `slug`.

There is no notion of who made a map. A map you build and one the owner
uploads by hand are the same rows through the same API. Nothing you write
outranks anything, and nothing blocks you — so the only thing keeping the
section useful is your judgement.

## Sources

1. **A screenshot the user gives you.** This is the primary path. Save it
   under `scripts/scratch/` (gitignored) and work from that file.
2. **A public fan-made map** when the user asks you to find one. Use a site
   that hosts complete, unannotated-or-labelled game maps at native
   resolution (vgmaps.com is the standard for consoles). Record the page URL
   as the map's `sourceUrl`. Prefer the original PNG over a resized copy — a
   palette PNG at 4096² is often smaller than a resized RGB one.
3. Never draw a map yourself, and never stitch screenshots — a wrong map is
   worse than no map.

Crop off credit panels and sidebars before uploading, and **do the crop with
the top-left corner anchored** (`sips` centre-crops by default; a canvas crop
in the browser or Python with explicit offsets is safer). Every coordinate
you record is relative to the *uploaded* image, so crop first, then read.

## Reading the image

Marker positions must come from looking at the image, not from memory. The
labels on a 4096px map are ~8px tall, so read them in pieces:

1. Note the full image size (`file map.png`).
2. Cut the image into overlapping crops of ~1000px (`sips -c H W --cropOffset Y X`
   — mind that the offset is **y then x**) and read each crop.
3. For each label, record the point the label names — the town sprite, the
   cave mouth — not the label text itself. Convert crop coordinates back to
   full-image pixels: `x = cropX + offsetX`, `y = cropY + offsetY`.
4. Read every crop before writing anything. Missing the far corner of the map
   is the usual mistake.
5. After writing, open `/game/<id>/map?m=<slug>` in the browser and click three
   or four list entries spread across the map. If a marker lands beside the
   map's own label rather than on it, your crop offset is off — fix the
   arithmetic, don't nudge markers by hand.

If the map has no labels (a plain screenshot), place markers only for things
you can identify with confidence from a cited walkthrough or wiki page, and
put that page in each marker's `sourceUrl`.

## Marker kinds

| `kind` | Use for |
| --- | --- |
| `town` | Towns, villages, camps — anywhere with people and shops |
| `castle` | Castles, palaces, fortresses, bases |
| `dungeon` | Dungeons, towers, temples — a place you fight through |
| `cave` | Caves and passes that are mostly a route |
| `shop` | A standalone shop, smith, inn, or service |
| `boss` | A boss encounter that has its own spot on the map |
| `item` | A notable pickup: heart container, key item, upgrade |
| `secret` | Hidden areas, warp zones, secret exits |
| `travel` | Transport: chocobo forests, airship docks, ferries, warps |
| `other` | Anything else — say what it is in `note` |

Names and kinds are the filter chips on a phone; stay in this vocabulary.

## What goes in which field

- **Map** `title` — short: "Overworld", "Underworld", "Dark World", "World 1".
  `subtitle` — optional flavour: "Blue Planet", "Lunar surface".
  `slug` — defaults to the slugified title; set it when you need a stable
  handle. `sourceUrl` — the page the image came from. `position` — display
  order among the game's maps (0 first).
- **Marker** `name` — as the game names it, the way the owner would look it
  up. Disambiguate repeats: "Chocobo Forest (Baron)". `x`,`y` — integer
  pixels of the uploaded image. `note` — one line: what you do or find there.
  No spoilers beyond what the map label already gives away unless asked.
  `sourceUrl` — only when the note came from somewhere specific.

## Rules

1. **Coordinates come from the image, never from memory.** If you did not
   read a label in a crop, do not place it.
2. **One curated set, not every tile.** An overworld wants every named
   location (20–40); a dungeon floor wants doors, chests, the boss. The cap
   is 300 markers per map and 20 maps per game.
3. **Use `replace: true`** when you re-derive a whole map from a fresh read;
   leave it off when adding a few markers to a map someone else built.
4. **Crop first, then read.** Sidebars and credits in the image shift every
   coordinate.
5. **Leave a game without a map rather than upload a wrong one.**

## Path

```bash
# Copies with no maps yet
curl -s -H "Authorization: Bearer $GAME_EXPLORER_TOKEN" "$GAME_EXPLORER_URL/api/maps/gaps?limit=50"
# → { total, gaps: [{ ownedGameId, title, name, platform, year, igdbId }] }

# 1. Create the map row (or refresh it — same slug updates in place)
curl -s -H "Authorization: Bearer $GAME_EXPLORER_TOKEN" -X POST "$GAME_EXPLORER_URL/api/games/<ownedGameId>/maps" \
  -H 'content-type: application/json' \
  -d '{ "title": "Overworld", "subtitle": "Blue Planet", "sourceUrl": "https://…", "position": 0 }'
# → { id: "<mapId>", slug: "overworld", width: 0, height: 0, … }

# 2. Upload the image bytes (PNG or JPEG, ≤ 16 MB). Records width/height.
curl -s -H "Authorization: Bearer $GAME_EXPLORER_TOKEN" -X PUT "$GAME_EXPLORER_URL/api/maps/<mapId>/image" --data-binary @scripts/scratch/overworld.png
# → { …, width: 4096, height: 4096 }

# 3. Write the markers — upsert by name; replace:true drops the ones not listed
curl -s -H "Authorization: Bearer $GAME_EXPLORER_TOKEN" -X POST "$GAME_EXPLORER_URL/api/maps/<mapId>/markers" \
  -H 'content-type: application/json' \
  -d '{ "replace": true, "markers": [
    { "name": "Baron", "kind": "castle", "x": 1630, "y": 2510, "note": "Kingdom of Baron; where the game opens." },
    { "name": "Misty Cave", "kind": "cave", "x": 1224, "y": 2120, "note": "First dungeon — the Mist Dragon." }
  ] }'
# → { written: [{ name, id }], skipped: [{ name, reason }], removed }
```

`skipped` reasons: "unknown kind", "(x, y) is outside the W×H image",
"named twice in this batch", "already at the 300-marker limit". Fix and resend.

**But partial success only covers those.** A coordinate outside `0..65535`, a
blank or over-long `name`, or more than 300 markers in one body fails *schema*
validation — the request comes back `400 invalid input` with the offending
indexes in the body, and **not one marker of the batch is written**. The
distinction matters at 200 markers: `x: 3000` on a 2000-wide image is one
skipped row, `x: 99999` is the whole pass lost. Sanity-check your crop
arithmetic before you POST — a coordinate in the tens of thousands almost
always means an offset was added twice.

Also: `GET /api/games/:id/maps` lists a copy's maps with markers; `GET
/api/maps/:mapId` reads one map; `PATCH /api/maps/:mapId` edits
title/subtitle/slug/sourceUrl/position; `DELETE /api/maps/:mapId` removes the
map, its markers and its image; `PATCH` / `DELETE
/api/maps/:mapId/markers/:markerId` for one marker; `GET
/api/maps/:mapId/image` reads the stored image bytes.

## Verify

Open `$GAME_EXPLORER_URL/game/<ownedGameId>/map?m=<slug>` in the browser at
a desktop width and at 390px. Click a few list entries in different corners
of the map and check the marker sits on the place the map itself labels.
Check the console is clean. Then open `/game/<ownedGameId>` and confirm the
Maps section shows a card per map with the right place count.

## Report

Say which copies you mapped, how many maps and markers each got, where each
image came from, which games you left without a map and why, and anything the
API skipped with its reason.
