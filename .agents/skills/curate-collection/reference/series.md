# Series

See `SKILL.md` for the env/auth preamble — do not skip it.

A series is an **ordered list of catalog games** — "every Mario Party",
"the Final Fantasy mainline games" — with ownership resolved when the page
renders, not stored. That is the one decision that shapes this whole API:

- **Membership is by IGDB id, not by owned copy.** An entry can point at a
  game nobody owns, and the series page shows it as the gap ("you own 7 of
  16"). That is the point — a series that only listed what you own would just
  be a saved shelf filter.
- An entry may instead be a **free-text title** with no `igdbId` at all, for a
  game IGDB has no entry for (`Roller Games` and the like). Every entry needs
  one or the other — never neither.
- Stance is the same as codes and maps: no `source` column, no precedence.
  What you write and what the owner curates by hand are one API, one kind of
  row.

## Nothing auto-publishes

A series is **IGDB-seeded, human-pruned**. `seed-preview` proposes a whole
IGDB collection; nothing is written until someone — you or the owner — decides
what to keep and POSTs it. There is no path that takes an IGDB collection id
and publishes a series from it unattended. If asked to "add a series for every
Zelda game", the job is: preview, prune with judgement (or ask the owner to
prune), then save what is kept — never save the raw collection wholesale.

## The seed → prune → save workflow

```bash
# 0. Optional: find a collection id by a game you already know is in it
curl -s -H "Authorization: Bearer $GAME_EXPLORER_TOKEN" "$GAME_EXPLORER_URL/api/series/collections?igdbId=1029"
# → [{ id, name, ... }] — a game is often in several ("Final Fantasy",
#   "Compilation of Final Fantasy VII", "Final Fantasy VII"); pick the one
#   that matches what "the series" means here.

# 1. Preview: nothing is written by this call.
curl -s -H "Authorization: Bearer $GAME_EXPLORER_TOKEN" -X POST "$GAME_EXPLORER_URL/api/series/seed-preview" \
  -H 'content-type: application/json' -d '{ "collectionId": 425 }'
# → { collection: { id, name }, candidates: [{ igdbId, name, cover, year,
#      ownedId, platformLabel, variants: [{ igdbId, name, year }] }], skipped: [...] }
# `candidates` already has ports/remakes collapsed into their primary via
# parentIgdbId, ordered by release date, and marked with the owned copy
# (`ownedId`), when there is one.
# `skipped` is member ids that came back empty — almost always the game_type
# filter refusing a DLC or episode in the collection; report it, don't chase it.

# 2. Prune with judgement (drop ports/spinoffs/remasters that do not belong,
#    per what the user asked for), then create the series with what is kept.
#    `seen` MUST include every id the preview showed — see "seenIgdbIds" below.
curl -s -H "Authorization: Bearer $GAME_EXPLORER_TOKEN" -X POST "$GAME_EXPLORER_URL/api/series" \
  -H 'content-type: application/json' -d '{
    "name": "Final Fantasy",
    "seedCollectionId": 425,
    "entries": [
      { "igdbId": 355, "section": "Mainline" },
      { "igdbId": 356, "section": "Mainline" }
    ],
    "seen": [355, 356, 999, 1000]
  }'
# → the full SeriesView: id, slug, entries resolved against the shelf, sections.
```

Entries you do not own are **hydrated into the catalog** as part of this call
(a full row when IGDB has one, a stub when it does not) — you never need to
import a game to put it in a series.

## `seenIgdbIds` — why a rejected port never comes back

Every series that was seeded from a collection stores `seenIgdbIds`: every id
the owner has ever been *shown* by a seed preview or check, whether they kept
it or not. This is what makes "check for new entries" honest:

- Record **every id shown, including the ports and remakes collapsed into a
  variant** — not just the primaries you kept as entries. If IGDB's parent
  link later changes and yesterday's variant arrives as its own candidate,
  only having recorded the primary would make it look "new" again.
- A candidate you deliberately did *not* keep must still go in `seen`. That is
  the entire mechanism that stops a rejected Switch port from reappearing
  every time someone checks this series.
- `POST /api/series` and `POST /api/series/:id/entries` both accept `seen`, and
  it is *additive* — it unions into whatever was recorded before, never
  replaces it.

## Checking for new entries later

```bash
curl -s -H "Authorization: Bearer $GAME_EXPLORER_TOKEN" -X POST "$GAME_EXPLORER_URL/api/series/<seriesId>/seed-check"
# → { collection, fresh: [...candidates...], skipped: [...], checkedAt }
```

This **diffs, it does not merge**: `fresh` is only what has appeared in the
IGDB collection since the last time this series' entries or `seen` were
updated. The only write this call makes is the `seedCheckedAt` timestamp — the
owner (or you, with their go-ahead) reviews `fresh` and then POSTs the ones
that belong to `.../entries`, passing `seen` covering every id `fresh` and
`skipped` contained, kept or not.

## Editing entries and the series itself

```bash
# Add more entries to an existing series (same shape as creation)
curl -s -H "Authorization: Bearer $GAME_EXPLORER_TOKEN" -X POST "$GAME_EXPLORER_URL/api/series/<seriesId>/entries" \
  -H 'content-type: application/json' -d '{ "entries": [{ "igdbId": 357, "section": "Mainline" }], "seen": [357] }'
# → { added: [...], skipped: [{ igdbId, title, reason }], unhydrated: [...] }
# An id already in the series is reported in `skipped` ("already in this
# series"), not a batch failure. `entries` may be [] when you are only
# recording `seen` — e.g. a seed-check where every candidate was rejected.

# Reorder — a permutation: every entry of this series, exactly once
curl -s -H "Authorization: Bearer $GAME_EXPLORER_TOKEN" -X PATCH "$GAME_EXPLORER_URL/api/series/<seriesId>/entries" \
  -H 'content-type: application/json' -d '{ "orderedIds": ["<id1>", "<id2>", "<id3>"] }'

# Remove several entries — positions close up so they stay dense 0..n-1
curl -s -H "Authorization: Bearer $GAME_EXPLORER_TOKEN" -X DELETE "$GAME_EXPLORER_URL/api/series/<seriesId>/entries" \
  -H 'content-type: application/json' -d '{ "ids": ["<id1>", "<id2>"] }'

# One entry at a time — add a note or section, or fix a free-text title
curl -s -H "Authorization: Bearer $GAME_EXPLORER_TOKEN" -X PATCH "$GAME_EXPLORER_URL/api/series-entries/<entryId>" \
  -H 'content-type: application/json' -d '{ "section": "Spin-off", "note": "…" }'
curl -s -H "Authorization: Bearer $GAME_EXPLORER_TOKEN" -X DELETE "$GAME_EXPLORER_URL/api/series-entries/<entryId>"
```

`entryPatchSchema` cannot change an entry's `igdbId` — only `title`, `section`,
`note`, `sourceUrl`. To fix a wrong game, remove the entry and add the right
one.

Reorder and remove are both **permutation/exact-match operations**, like
manual page reordering: a partial `orderedIds` list is rejected (400) rather
than silently pushing forgotten entries to the end.

## Sections

`section` is a free-text label ("Mainline", "Spin-off", "Remakes") entries are
grouped under, in the order sections first appear; entries with no `section`
group under an unheaded default. Use it to organize a long series (a `Final
Fantasy` series listing mainline numbered entries separately from
`Tactics`/`Crystal Chronicles` spin-offs), not as a second tagging system.

## Editing the series itself

```bash
curl -s -H "Authorization: Bearer $GAME_EXPLORER_TOKEN" -X PATCH "$GAME_EXPLORER_URL/api/series/<seriesId>" \
  -H 'content-type: application/json' -d '{ "blurb": "The mainline numbered entries, NES through the PS5 remakes." }'
curl -s -H "Authorization: Bearer $GAME_EXPLORER_TOKEN" -X DELETE "$GAME_EXPLORER_URL/api/series/<seriesId>"
```

`PATCH /api/series/:seriesId` edits `name`, `slug`, `blurb`, `coverImageId`
(an IGDB image id overriding the derived cover), `position` and
`seedCollectionId` — never `entries` or `seen`, which only the entries routes
touch. `blurb` is one line citing/describing the series, not prose about any
one game in it — same "cite, don't author" stance as everywhere else in this
app. `DELETE` removes the series and every entry with it (cascade); owned
copies and catalog rows are untouched.

`GET /api/series` lists every series as a card (name, derived cover, "owned /
total"); `GET /api/series/<seriesId>` returns the full page view with entries
resolved against the shelf and grouped into sections.

## Report

Say which series you built or updated, the collection it was seeded from (if
any), how many candidates you saw vs. how many you kept and why you dropped
the rest, and confirm `seen` covers everything shown. For a seed-check, say
how many `fresh` candidates came back and your recommendation on each.
