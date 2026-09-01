# Background music

See `SKILL.md` for the env/auth preamble — do not skip it.

A track is **one audio file the owner already has**, attached to an owned copy
(`ownedGameId`), like codes, maps and manuals. Turn the setting on
(Settings → Background music, per device, off by default) and opening a game's
page plays one of that copy's tracks at random. A game with no tracks is
silent, which is the state of nearly the whole shelf and is fine.

Keyed on the **copy**, not the catalog game, on purpose: the NES and the SNES
version of a title have genuinely different soundtracks. Registering music for
the NES Castlevania says nothing about the collection's other Castlevanias.

Same stance as codes, maps, bookmarks and manuals: no `source` column, no
precedence. A track you register and a track the owner adds are the same kind
of row.

## The one rule

**You never source music. You only register music the owner hands you.**

- Do **not** download, stream-rip, torrent, or fetch audio from anywhere.
- Do **not** convert, transcode, trim or normalise it. Upload the bytes as
  they are.
- Do **not** generate, synthesise or compose anything.
- Do **not** go looking through the owner's disk. Their music library is
  theirs; work only with the exact files or folder they name in the
  conversation, and never list or upload a library wholesale.
- Do **not** invent a path. The API takes ids and bytes — never a filename,
  never a directory — and the server refuses anything that resolves outside
  its own music directory.

If you have no owner-supplied file in hand, you have nothing to register. Say
so. This is the one domain where "I could not find a source" is the correct
outcome rather than a failed search: there is no legitimate place to look.

MP3 only, decided with the owner — anything else comes back `415`.

## The two-step write: row, then bytes

Like a manual page, a track is created as a row and given its audio
separately: a JSON body and a multi-megabyte MP3 do not belong in one request.
A track with no audio yet is a real state, not an error — it simply is not
playable, so it does not appear in the list the player reads.

```bash
# 1. Create the track row
curl -s -H "Authorization: Bearer $GAME_EXPLORER_TOKEN" -X POST "$GAME_EXPLORER_URL/api/games/<ownedGameId>/music" \
  -H 'content-type: application/json' \
  -d '{ "title": "Vampire Killer" }'
# → { id: "<trackId>", title: "Vampire Killer", contentType: "audio/mpeg", bytes: 0, … }

# 2. Upload that track's audio (MP3, ≤ 32 MB). Records the size on the row.
curl -s -H "Authorization: Bearer $GAME_EXPLORER_TOKEN" -X PUT "$GAME_EXPLORER_URL/api/music/<trackId>/audio" \
  --data-binary @"<the file the owner named>"
# → { …, bytes: 4183044 }
```

`--data-binary @file` (or `-T file`), never a form upload and never a
re-encode. `title` is the piece as a person reads it — "Vampire Killer", not
`01_vampire_killer.mp3` — and non-ASCII is fine: "Étude", "Zelda – Overworld"
and "ドラキュラ伝説" are all accepted exactly as written.

Because this goes through the API, the audio lands on whichever server
`$GAME_EXPLORER_URL` names. Registering music is therefore an ordinary write to
the collection, with the same stop-and-ask rule as every other domain: an
unset `GAME_EXPLORER_URL` means stop, never localhost.

## Routes

- `GET /api/games/:id/music` — this copy's playable tracks:
  `{ "tracks": [{ "id", "title" }] }`. Tracks with no audio uploaded yet are
  deliberately absent. Public, like the map and manual image routes — the
  player fetches it on every game page.
- `GET /api/games/:id/music/all` — **every** track row, uploaded or not, with
  `bytes` and `contentType`. Owner only. This is the one that finds a row whose
  POST landed and whose PUT did not.
- `POST /api/games/:id/music { title }` — create the row.
- `PUT /api/music/:trackId/audio` — upload the bytes.
- `GET /api/music/:trackId/audio` — the audio itself (public; supports
  `Range`). Takes the **id**, never a path.
- `DELETE /api/music/:trackId` — removes the row and unlinks the file.

## Caps and gotchas

- **60 tracks per copy, ≤ 32 MB per file, MP3 only** (`415` otherwise, and
  the check reads the bytes — a `content-type` header proves nothing).
- **No `gaps` endpoint.** There is no batch-research workflow here, because
  there is no research: a track has to be a file the owner gives you. Work
  from what they hand you or name.
- **A track is never upserted.** POSTing the same title twice makes two rows
  and the game plays both. Before adding, `GET /api/games/:id/music/all` and
  check what is already there.
- **An upload is all-or-nothing.** Over 32 MB comes back `413` before a byte is
  read; a body that arrives shorter than its `content-length` comes back `400`
  and nothing is stored. A `200` means the whole file landed — if you see
  either error, the track row still exists with `bytes: 0` and you should retry
  the PUT rather than POST a second row.
- **The audio is not in `db:snapshot`.** The `MusicTrack` rows are; the files
  live beside maps, journal photos and manual scans and travel in
  `npm run backup`. Never suggest restoring a snapshot as a way to move music.
- A track whose audio you never uploaded is invisible to the player but still
  counts toward the 60. If a game is unexpectedly silent, list its tracks with
  `GET /api/games/:id/music/all` — a row with `bytes: 0` is the usual reason.
  Either PUT its audio or `DELETE /api/music/:trackId` it.

## Verify

```bash
# Everything registered on this copy (owner only), the player's own view of it,
# and the bytes behind one track.
curl -s -H "Authorization: Bearer $GAME_EXPLORER_TOKEN" "$GAME_EXPLORER_URL/api/games/<ownedGameId>/music/all"
curl -s "$GAME_EXPLORER_URL/api/games/<ownedGameId>/music"
curl -s -o /dev/null -w '%{http_code} %{content_type} %{size_download}\n' \
  "$GAME_EXPLORER_URL/api/music/<trackId>/audio"
# → 200 audio/mpeg <the file size>
```

The last two reads are public, so no token is needed for them; `/music/all` is
owner-only like every other listing in this API. Then, in a
browser: Settings → Background music on, open the game, and it should start
within a second. If a "Play music" button appears instead, that is the
browser's autoplay policy asking for a tap on a page that was opened without
one — expected, not a bug.

## Report

Say which copy got which tracks, how many, and — plainly — that every file
came from the owner. If you were given a folder and only some of it was
usable, say what you skipped and why (not an MP3, over the size cap,
unidentifiable). Never describe a track you did not actually upload bytes for.
