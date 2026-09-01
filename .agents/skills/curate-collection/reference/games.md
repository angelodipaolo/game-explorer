# Games

See `SKILL.md` for the env/auth preamble — do not skip it.

The owned copy itself: finding one, reading what is already on it, correcting
it, removing it — and the staged import that is the only way a new one gets in.

## Find a game

Almost every other reference file starts with "you have an `ownedGameId`".
This is where you get one. `GET /api/games` is the only route that enumerates
the shelf — the `gaps` listings each return games *missing* one kind of data,
which is a work queue, not the collection.

```bash
curl -s -H "Authorization: Bearer $GAME_EXPLORER_TOKEN" "$GAME_EXPLORER_URL/api/games?q=sonic"
# → { "games": [ { "ownedGameId": "cm…", "igdbId": 1029, "name": "Sonic the Hedgehog 2",
#                  "platform": "genesis", "platformLabel": "Genesis", "quantity": 1,
#                  "coverImageId": "co1x2y", "firstReleaseYear": 1992 } ],
#     "nextCursor": null }
```

Every row carries the `igdbId` as well as the `ownedGameId`, because the two
are used for different things and asking twice is a round trip per game:

| id | what takes it |
| --- | --- |
| `ownedGameId` | everything hung off a copy — codes, facts, tags, maps, bookmarks, manuals, music |
| `igdbId` | series entries (`POST /api/series`, `.../entries`), which list *games*, owned or not |

| param | meaning |
| --- | --- |
| `q` | title search. Every word must appear somewhere in the title, in any order, so `q=sonic 2` finds "Sonic the Hedgehog 2". Case and punctuation do not matter, and a run-together query is split at the digit: `sonic2` works too. A query with nothing matchable in it at all (`---`, or a title in a non-Latin script) is a `400`, not an empty page. |
| `platform` | platform slug or alias, **repeatable**: `?platform=nes&platform=snes`. `?platform=Super%20Nintendo` resolves to the same thing. An unknown console is a `400`, not an empty list. |
| `limit` | default 50, max 200 |
| `cursor` | pass back `nextCursor` verbatim for the next page; `null` means that was the last one |

`q` matches the **shelf's** title, which is usually but not always the catalog
name that comes back in `name`. If a search comes up empty, drop a *word* —
`q=zelda` beats `q=the legend of zelda a link to the past`. Do not reach for
short fragments: matching is by substring, so one- and two-character tokens
match almost every title (`t2` and `ff7` are noise, not shortcuts), and a bare
number matches anything containing it — `final fantasy 7` also finds "Final
Fantasy 17". Read the names back rather than trusting the first hit. The one
thing `q` cannot do is split a run-together query with no digit in it
(`ducktales` will not find "Duck Tales"); type the spaces.

Two copies of one title on different platforms are **two rows**, each with its
own `ownedGameId`, because everything you can do here happens to one copy.

### Look before you write

```bash
curl -s -H "Authorization: Bearer $GAME_EXPLORER_TOKEN" "$GAME_EXPLORER_URL/api/games/<ownedGameId>"
# → { …the same fields…, "counts": { "codes": 4, "maps": 1, "bookmarks": 0,
#                                    "manuals": 0, "tags": 3, "music": 0 } }
```

The counts say what is already there. Research nobody needed is the most
expensive thing you can do here.

### Correct a record

`PATCH` fixes what an import got wrong — the platform it read off a
spreadsheet, the number of copies it counted from repeated rows, the
condition, or the catalog game it matched.

```bash
curl -s -H "Authorization: Bearer $GAME_EXPLORER_TOKEN" -X PATCH "$GAME_EXPLORER_URL/api/games/<ownedGameId>" \
  -H 'content-type: application/json' \
  -d '{ "platform": "snes", "quantity": 2, "condition": "good" }'

# Re-link a mismatched game. This re-runs the catalog sync, exactly as import
# does, so the new link comes with its summary, art and player data.
curl -s -H "Authorization: Bearer $GAME_EXPLORER_TOKEN" -X PATCH "$GAME_EXPLORER_URL/api/games/<ownedGameId>" \
  -H 'content-type: application/json' -d '{ "igdbId": 1029 }'
# {"igdbId": null} unlinks — an honest "IGDB has no entry for this" beats a wrong link.
```

- There is **no title field**. Changing a title changes the shelf's dedupe key;
  the honest fix is to import the right row and delete the wrong one.
- `409` means that title is already on the shelf for that platform. That is a
  merge, not an edit: raise the other copy's `quantity` and delete this row.
- `422` means IGDB has no game of that id that this app catalogs (DLC,
  expansions, packs and romhacks are filtered out). `502` means IGDB could not
  be reached. In both cases **nothing was changed** — the old link stands.
- Never guess a catalog link. A wrong one puts another game's co-op tags,
  cover and playtime on this cartridge.

### Remove a copy

```bash
curl -s -H "Authorization: Bearer $GAME_EXPLORER_TOKEN" -X DELETE "$GAME_EXPLORER_URL/api/games/<ownedGameId>"
# → { "ownedGameId": "cm…", "title": "Castlevania", "platform": "nes",
#     "files": { "maps": 1, "manualPages": 12, "journalPhotos": 3, "musicTracks": 2 } }
```

**This is the one write in the whole API with no undo.** An import commit has
a batch you can roll back; a fact has precedence; a code can be re-added. This
takes the copy, its codes, facts, tags, maps, markers, bookmarks, manuals,
pages, music, journal entries and play history — **and its place in the up-next
queue**, so a game queued on `/playing` simply stops being there — and it
unlinks the map images, manual scans, journal photos and MP3s from disk. There
is no bulk form, and there must not be one.

The `files` numbers count the **rows whose blobs were cleared**, not files that
were definitely on disk: a map row whose image was never uploaded still counts
one.

So: **ask the owner before deleting anything.** Say what it is and what the
counts were. A `409` means the copy has a run in progress — that is the server
refusing to destroy a playthrough that is actually happening; tell the owner
rather than finishing the run to get past it.

Games are never *added* this way. A new game enters through the staged import
below, so every addition stays one undoable batch.

## Import games

You are the smart client. The API owns validation, matching, dedupe, and the
transaction. You own parsing, normalizing, and judgment on the rows it holds.

## 1. Parse

Turn whatever you were given into rows of:

```json
{ "title": "Duck Tales", "platform": "NES", "quantity": 1, "completeness": "cib", "condition": "good", "notes": null }
```

- `title` is required. Keep the shelf's spelling; the API normalises.
- `platform` is free text. These all resolve to one value: `NES`, `Nintendo`,
  `Nintendo Entertainment System`, `Famicom`. Same for `SNES` / `Super
  Nintendo`, `PS1` / `PlayStation` / `PSX`, `Genesis` / `Mega Drive`, etc.
  (see `src/lib/platforms.ts`). Unknown platforms are held as `invalid`.
- A platform written **into the title** (`Joe and Mac Super Nintendo`) should be
  peeled off into `platform`.
- Bracketed tags stay in the title — `Pac-Man [Tengen]` — the matcher strips
  them for scoring and keeps them for the shelf.
- Do **not** add up duplicates yourself unless the source clearly means copies.
  Repeated rows from repeated exports are not copies. When in doubt, quantity 1.
- Drop hardware (consoles, controllers) and obvious test residue. Say what you
  dropped.

## 2. Create a session, submit in batches

```bash
curl -s -H "Authorization: Bearer $GAME_EXPLORER_TOKEN" -X POST "$GAME_EXPLORER_URL/api/import/sessions" -H 'content-type: application/json' \
  -d '{"label":"shelf photo 2026-08-28","source":"agent","rows":[]}'
# → { "id": "<sessionId>", ... }

curl -s -H "Authorization: Bearer $GAME_EXPLORER_TOKEN" -X POST "$GAME_EXPLORER_URL/api/import/sessions/<sessionId>/rows" -H 'content-type: application/json' \
  -d '{"defaultPlatform":"NES","rows":[ ...≤25 rows... ]}'
```

Each row comes back with:

| field | meaning |
| --- | --- |
| `decision` | `auto` (confident match), `review` (held), `merge` (duplicate within the session), `accepted`, `dropped` |
| `holdReason` | `no-match`, `ambiguous`, `low-confidence`, `duplicate` (already on the shelf), `invalid` |
| `candidates` | ranked IGDB candidates with `confidence` (0–1) and a `reason` |
| `chosenIgdbId` | what `auto` picked |

Batches of ≤ 25 keep each call under ~20 s (IGDB is rate-limited to 4 req/s).

Other session routes: `GET /api/import/sessions` (every session), `GET
/api/import/sessions/<sessionId>` (one session with every row), `DELETE
/api/import/sessions/<sessionId>` (discard an unfinished session), `GET
/api/import/batches` (past commits), `POST /api/import/csv` (multipart
`file` field, or a raw `text/csv` body — creates a session directly instead of
building rows by hand).

## 3. Resolve what you can, hand the rest to the user

Read `GET /api/import/sessions/<sessionId>` and go through every `review` row.

Decide yourself when the answer is not in doubt:

- **`low-confidence` with a candidate whose reason is "candidate adds
  subtitle"** (`Skate or Die 2` → `Skate or Die 2: The Search for Double
  Trouble`): accept it.
- **`ambiguous` where one candidate is exact and the other is an alt-name of a
  different game**: accept the exact one.
- **A candidate marked "IGDB lists no release on this platform"** whose
  platforms include one plausible physical platform (`Super Metroid` searched
  as NES → SNES): accept it *and* move the row with `"platform": "snes"`.
- **`duplicate`**: if the input genuinely means another copy, `merge`; if it is
  the same list re-exported, `dropped`.

```bash
curl -s -H "Authorization: Bearer $GAME_EXPLORER_TOKEN" -X PATCH "$GAME_EXPLORER_URL/api/import/sessions/<sessionId>/rows/<rowId>" -H 'content-type: application/json' \
  -d '{"decision":"accepted","igdbId":48181,"decidedBy":"agent"}'
# other bodies: {"decision":"dropped"}  {"decision":"merge"}
#               {"decision":"accepted","igdbId":null}        ← import with no catalog link
#               {"decision":"accepted","igdbId":1103,"platform":"snes"}
```

**Stop and ask the user** — list the row, the candidates, and your best guess —
when:

- two candidates are both exact matches with the same name (`Tetris` has a
  Nintendo and a Tengen cartridge; `Wolverine` has a release and a prototype);
- the best candidate is below 0.8 and nothing in its reason explains the gap;
- the only candidate is a different game with the same words (`Sesame Street
  123` vs `Sesame Street ABC & 123`);
- `no-match` — offer "import without a match" but let the user decide;
- the row is `invalid` (unknown platform) and the fix is not obvious.

Never guess a catalog link. An unlinked row is honest; a wrong link puts
another game's co-op tags on this cartridge.

## 4. Commit

```bash
curl -s -H "Authorization: Bearer $GAME_EXPLORER_TOKEN" -X POST "$GAME_EXPLORER_URL/api/import/sessions/<sessionId>/commit" -H 'content-type: application/json' -d '{}'
```

A 409 lists rows still in `review`. `{"force":true}` imports them unlinked —
only do that if the user said so. The response has `batchId`, and counts of
created / merged / dropped / unlinked.

## 5. Report, and how to undo

Tell the user: how many rows, how many matched automatically, every decision
you made on a held row and why, anything left unlinked, and the undo command:

```bash
curl -s -H "Authorization: Bearer $GAME_EXPLORER_TOKEN" -X POST "$GAME_EXPLORER_URL/api/import/batches/<batchId>/rollback"
```

Rollback removes exactly the rows that batch created (and reverses quantity
merges) and nothing else.

The review page at `$GAME_EXPLORER_URL/import/<sessionId>` shows the same
session for the user, with the same actions.
