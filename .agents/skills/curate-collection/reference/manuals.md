# Manuals

See `SKILL.md` for the env/auth preamble — do not skip it.

A manual is **one or more scanned page images in reading order**, attached to
an owned copy (`ownedGameId`), like codes and maps. Mechanically it is a map
with pages instead of markers — same on-disk image store, same stance: no
`source` column and no precedence. A manual you scan and one the owner scans
are the same rows through the same API.

A copy can hold several manuals (the instruction booklet, a separate map
insert, a strategy pamphlet) — up to 10. A manual holds up to 200 pages,
numbered densely 0..n-1: "page 4 of 12" is always literally true, because
every insert, reorder and delete renumbers the rest.

## The two-step write: row, then bytes

A page is created as an empty row and then given its image separately — a
JSON body and a multi-megabyte scan do not belong in one request. A page with
no image yet is a real, renderable state ("not scanned yet"), not an error.
So the sequence is always:

1. `POST /api/games/<ownedGameId>/manuals` to create the manual (once).
2. `POST /api/manuals/<manualId>/pages` once per page, to create its row.
3. `PUT /api/manual-pages/<pageId>/image` with the raw bytes of that page.

## Path

```bash
# 1. Create the manual
curl -s -H "Authorization: Bearer $GAME_EXPLORER_TOKEN" -X POST "$GAME_EXPLORER_URL/api/games/<ownedGameId>/manuals" \
  -H 'content-type: application/json' \
  -d '{ "title": "Manual", "sourceUrl": "https://…" }'
# → { id: "<manualId>", title: "Manual", position: 0, … }
# title defaults to "Manual" if omitted — the common case needs no typing.

# 2. Add each page in order (appends by default; pass "position" to insert)
curl -s -H "Authorization: Bearer $GAME_EXPLORER_TOKEN" -X POST "$GAME_EXPLORER_URL/api/manuals/<manualId>/pages" \
  -H 'content-type: application/json' -d '{ "label": "Controls" }'
# → { id: "<pageId>", position: 0, label: "Controls", width: 0, height: 0, … }

# 3. Upload that page's scan (PNG or JPEG, ≤ 16 MB). Records width/height.
curl -s -H "Authorization: Bearer $GAME_EXPLORER_TOKEN" -X PUT "$GAME_EXPLORER_URL/api/manual-pages/<pageId>/image" --data-binary @scripts/scratch/page-01.jpg
# → { …, width: 1650, height: 2550 }
```

Repeat steps 2–3 for every page, in reading order, so appending naturally
lands them in the right sequence. If you discover a missed page later, POST it
with `{ "position": 3 }` to insert it — everything after shifts down, so you
never have to re-upload pages you already scanned.

## Reordering and editing

```bash
# Reorder: the body must list every page of this manual, exactly once
curl -s -H "Authorization: Bearer $GAME_EXPLORER_TOKEN" -X PATCH "$GAME_EXPLORER_URL/api/manuals/<manualId>/pages" \
  -H 'content-type: application/json' -d '{ "orderedIds": ["<id1>", "<id2>", "<id3>"] }'
```

This is a **permutation, not a move**: a partial list is rejected (400) rather
than silently pushing the pages it forgot to the end — like `reorderPages` and
the play queue elsewhere in this app. Fetch the manual's current pages first
(`GET /api/games/:id/manuals`) if you need the full id list.

Other routes:

- `GET /api/games/:id/manuals` — this copy's manuals with their pages, in
  reading order.
- `PATCH /api/manuals/:manualId { title?, sourceUrl?, note?, position? }` —
  edit the manual itself (`position` orders manuals within the copy).
- `DELETE /api/manuals/:manualId` — removes the manual, every page row, and
  every page's image file.
- `PATCH /api/manual-pages/:pageId { label? }` — rename one page (e.g. "Map",
  "Controls", "Item list").
- `DELETE /api/manual-pages/:pageId` — removes one page and its file; the rest
  renumber automatically so the sequence stays dense.
- `GET /api/manual-pages/:pageId/image` — the stored scan (public route, like
  map and journal images — every visitor's manual viewer needs to load it).

## Caps and gotchas

- **10 manuals per copy, 200 pages per manual, ≤ 16 MB per image** (PNG or
  JPEG — anything else is rejected with 415).
- **No `gaps` endpoint for manuals.** There is no batch-research workflow here
  the way there is for codes or bookmarks — a manual has to actually be
  scanned or given to you, page by page, so there is nothing to look up in
  bulk. Work from what the user hands you or asks for by name.
- **A manual is never upserted by content.** Unlike a map's slug, there is no
  natural key: creating a manual always makes a new row. Two scans of the same
  booklet are two manuals — don't create a fresh one if the user is adding
  pages to an existing scan; add pages to the manual you already have.
- Reordering pages and reordering manuals are different operations: pages
  reorder via `PATCH /api/manuals/:manualId/pages`; the manuals themselves
  (which one shows first on the game page) reorder by PATCHing each manual's
  own `position`.

## Report

Say which copy got a manual, how many pages, where the scan came from (a file
the user gave you, or a source you cite via `sourceUrl`), and the reading
order you used. If pages arrived out of order, say which ones you inserted and
where.
