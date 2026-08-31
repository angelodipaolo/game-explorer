---
name: import-collection
description: Import games into Game Explorer from a CSV, spreadsheet, list, or photo of a shelf. Use when the user says "import these games", "add this CSV to the shelf", "add these cartridges", or hands you any list of owned games. Drives the staged import API — you parse and normalize, the API validates, matches against IGDB, dedupes, and commits as one undoable batch.
---

# Import a collection

You are the smart client. The API owns validation, matching, dedupe, and the
transaction. You own parsing, normalizing, and judgment on the rows it holds.

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
