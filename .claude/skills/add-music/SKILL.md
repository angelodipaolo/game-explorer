---
name: add-music
description: Register the owner's own soundtrack files as background music for games in Game Explorer — copy MP3s the owner already has into data/music/ and record them in data/music/index.json so a game page plays one at random. Use when asked to "add music for", "register these soundtracks", "hook up the Castlevania music", or handed a folder of the owner's game music.
---

# Register the owner's music with the collection

Game Explorer can play a background track while a game's page is open
(GAMEEXPLOR-0025). It is off by default, per browser, behind **Settings →
Background music**, and only games that are *registered* ever make a sound.

Your job is the registry: take files the owner already has, put them where the
app can serve them, and write down which game each one belongs to.

## The one rule

**You never source music. You only register music the owner hands you.**

- Do **not** download, stream-rip, torrent, or fetch a track from anywhere.
- Do **not** convert, transcode, re-encode, trim or normalise audio.
- Do **not** generate, synthesise or compose anything.
- Do **not** go looking through the owner's disk. The soundtrack library is
  theirs; work only with the exact files or folders they name in this
  conversation, and never list or copy the library wholesale.
- Do **not** put audio anywhere but `data/music/`. Never `public/`, never the
  repo, never a path outside the music directory. The app refuses to serve a
  file that resolves outside `data/music/` anyway — do not try to find the
  gap.
- Do **not** commit an audio file or the manifest. `/data/music/` is
  gitignored, for the same reason `data/maps/` and `data/journal/` are: those
  are the owner's files, not the project's.

If you have no owner-supplied file in hand, you have nothing to do. Say so.

## Where music lives

```
data/music/
  index.json                          the manifest — the only id → file map
  castlevania/
    01 Vampire Killer.mp3
    02 Stalker.mp3
  super-mario-bros-3/
    01 Overworld.mp3
```

One folder per game, named however reads well; the manifest is what actually
matters. MP3 only — decided with the owner. Not MIDI, not FLAC, not WAV: the
route serves `audio/mpeg` and nothing else.

**`data/music/` is per machine.** It is gitignored and outside
`npm run db:snapshot`, so it does not travel with a push. The collection the
owner sees is served by the **Mac mini**, so music only reaches the shelf when
the files are in `data/music/` *on the mini*: either do this work in the
checkout on the mini, or leave the folder and the manifest entry ready and tell
the owner exactly what to copy across. Registering music in a checkout on a
laptop is a dev copy, exactly like `prisma/dev.db` — it plays locally and
changes nothing anyone else will hear. Say which one you did.

`npm run backup` archives `data/music/` alongside `data/maps/`,
`data/journal/` and `data/manuals/`.

## The manifest

`data/music/index.json`, validated by `src/lib/music/manifest.ts`. A file that
does not parse is treated as *no music at all*, silently — so verify after
every edit (below).

```json
{
  "version": 1,
  "games": [
    {
      "igdbId": 1258,
      "title": "Castlevania",
      "aliases": ["Akumajou Dracula"],
      "tracks": [
        { "id": "castlevania-vampire-killer", "title": "Vampire Killer", "file": "castlevania/01 Vampire Killer.mp3" },
        { "id": "castlevania-stalker", "title": "Stalker", "file": "castlevania/02 Stalker.mp3" }
      ]
    }
  ]
}
```

| Field | Rule |
| --- | --- |
| `version` | Always `1`. |
| `games[].igdbId` | **The match key**: the IGDB id of the *catalog* game, not an owned-copy id. One entry covers every platform the owner has that game on. Optional only for a copy IGDB has no entry for. Unique across the manifest. |
| `games[].title` | The game as a human reads it. Also the first title the fallback match tries. |
| `games[].aliases` | Alternate spellings. Only ever consulted for a copy with **no** catalog link, and only on an exact match after normalisation (case, punctuation and `&`/`and` are folded; nothing else is). |
| `games[].tracks[].id` | Stable and unique across the whole manifest. Letters, digits, `-`, `_` only — no dots, no slashes: this id is a URL segment. Prefix it with the game so ids stay obviously distinct. |
| `games[].tracks[].title` | The piece's name ("Vampire Killer"), not the filename. |
| `games[].tracks[].file` | Path **relative to `data/music/`**, ending in `.mp3`, at most four segments deep. Never absolute, never containing `..`. |

A game with no entry is silent. That is the intended state for most of the
shelf — there is no fuzzy fallback, and an unconfident match must stay unmade.

## Doing it

1. **Confirm the files.** Ask the owner which files or folder, if they have not
   already said. Do not go hunting.

2. **Find the IGDB id.** Every skill's environment applies here too:

   ```bash
   : "${GAME_EXPLORER_URL:?stop and ask the owner which server}"
   : "${GAME_EXPLORER_TOKEN:?stop and ask the owner for an API token}"
   ```

   The cheapest full listing of the shelf with its ids is the maps-gap route —
   ignore the maps part of it, it lists every copy:

   ```bash
   curl -s -H "Authorization: Bearer $GAME_EXPLORER_TOKEN" \
     "$GAME_EXPLORER_URL/api/maps/gaps?limit=500" |
     python3 -c 'import json,sys; [print(g["igdbId"], "|", g["name"], "|", g["platform"]) for g in json.load(sys.stdin)["gaps"]]'
   ```

   If the copy has `"igdbId": null` — a game IGDB does not know — leave
   `igdbId` out of the entry and match by `title`/`aliases` instead. If you
   cannot tell which game a folder is, **stop and ask**. A wrong id plays the
   wrong soundtrack on someone's game page and nothing about it looks broken.

3. **Copy the files in**, from the paths the owner gave you:

   ```bash
   mkdir -p data/music/castlevania
   cp "<the file the owner named>" "data/music/castlevania/01 Vampire Killer.mp3"
   ```

   `cp`, never `curl`, never `ffmpeg`. Keep the bytes exactly as they are.

4. **Edit `data/music/index.json`.** Create it (with `{"version": 1, "games": []}`)
   if it is not there. Add one object per game; append tracks to the existing
   object when the game is already registered rather than adding a second entry
   for the same `igdbId` — a duplicate id fails validation and silences the
   whole manifest.

5. **Verify** (below), then tell the owner which games now have music, how many
   tracks each, and — if you worked in a local checkout — that the files still
   have to reach the mini.

## Adding an alias

Aliases exist for one case: the shelf copy has **no** IGDB link and its title
is not spelled the way the soundtrack folder is. Add the shelf's spelling to
`aliases` and keep `title` readable:

```json
{ "title": "Zelda II: The Adventure of Link", "aliases": ["Zelda 2", "Adventure of Link"], "tracks": [ ... ] }
```

An alias is a human asserting "these are the same game". It is never a guess,
never a partial match, and it does nothing at all for a copy that already has
an `igdbId` — the id wins there, always.

## Verify

The manifest is re-read whenever the file changes; nothing needs restarting.

```bash
# 1. It parses, and says what you think it says.
python3 -m json.tool data/music/index.json > /dev/null && echo "manifest ok"

# 2. The app agrees. Against a running server ($GAME_EXPLORER_URL, or
#    http://localhost:3000 for a local checkout you are testing):
curl -s "$GAME_EXPLORER_URL/api/music/games/<ownedGameId>"
# → {"tracks":[{"id":"castlevania-vampire-killer","title":"Vampire Killer"}, ...]}
# An empty list means the match did not land: wrong igdbId, or a title that
# does not normalise to the alias you wrote.

# 3. The bytes are actually servable.
curl -s -o /dev/null -w '%{http_code} %{content_type} %{size_download}\n' \
  "$GAME_EXPLORER_URL/api/music/tracks/castlevania-vampire-killer"
# → 200 audio/mpeg <the file size>
# A 404 here with a track that IS in the manifest means the file was never
# copied across, or its `file` path is wrong.
```

Both routes are public reads (`src/proxy.ts`), so no token is needed for those
two — and both take **ids**, never paths. There is no route that lists the
directory and there must never be one.

Then, in a browser: Settings → Background music on, open the game, and it
should start within a second of the page. If a "Play music" button appears
instead, that is the autoplay policy asking for a tap — expected on a page that
was opened without one, not a bug.

## Stop and ask when

- The owner has not named a file or folder.
- You cannot confidently identify the game a folder belongs to.
- A file is not an MP3.
- `GAME_EXPLORER_URL` or `GAME_EXPLORER_TOKEN` is unset, or a call comes back
  `401`.
- You are asked to find, download, convert or make music. That is not this
  skill, and there is no other skill for it.
