# Play state: runs and the up-next queue

See `SKILL.md` for the env/auth preamble — do not skip it.

Two things live here, and they are the only two in this app that are about the
owner rather than about a game:

- **Runs** (`PlaySession`) — the log of actually playing a copy. "Playing now",
  "played, finished it", "played it years ago and gave up" are all one kind of
  row.
- **The queue** (`QueueEntry`) — one ordered "up next" list across the whole
  shelf. Not a playlist, not a wishlist, not a filing system: a short plan for
  what to play next.

Both were closed to agents entirely until GAMEEXPLOR-0031. They are open now
under one rule, and the rule is the entire reason they could be opened.

## Record, never infer

**An agent may write a session the owner described. It must never derive one —
not from a journal entry, not from "you usually play on Sundays", not from a
completion percentage. If a date was not stated, ask; do not guess.**

That sentence is the whole permission. Read it as a hard boundary, not as
guidance about accuracy:

- "I finished Contra last night" is dictation. Write it.
- "You bookmarked three Chrono Trigger guides in March, so you were probably
  playing it then" is a fabricated memory. Refuse it.
- "Mark everything on the NES shelf as played" is the same fabrication at
  scale. Refuse it, and say why.
- "I played Super Metroid a bunch in the nineties" has no date in it. Either
  ask for one, or record it `undated` — never pick a plausible year.

A wrong tag or a bad Game Genie code is visibly wrong on the page: the owner
opens the game, sees nonsense, deletes it. A run is not like that. Nothing on
the page can contradict "you played this on 3 August 2026", and a year later
nobody can tell which rows were remembered and which were reasoned out. That
asymmetry — not squeamishness — is why the rule is absolute, and it is the same
reason the **journal stays closed to agents entirely** (`SKILL.md`, "Never
write these"). Notes and photos are prose about the owner's life; there is no
dictation shape for them.

The queue is safe by a different argument: it is a plan rather than a memory,
nothing about it is a claim that anything happened, and a wrong entry is one
tap to remove on `/playing`. Suggest freely there; still never queue something
in place of asking what the owner actually wants to play.

## Play state is derived, and there is no status column

`OwnedGame` has no `status` field and never will — a column cannot represent
playing a game twice, and this shelf is full of games that get replayed every
few years. Everything the UI shows is computed from the session log:

| What the app says | What that means in the rows |
| --- | --- |
| playing now | at least one session with `endedAt` null |
| played | sessions exist, all of them closed |
| never played | no sessions at all |

So there is nothing to "set". To mark a game as being played you start a run;
to mark it finished you close that run. Do not go looking for a field.

**A run and a queue entry are per copy**, keyed on `ownedGameId`, exactly like
codes, maps and music. Playing the NES Contra says nothing about the SNES one.

## Dates: send bare `YYYY-MM-DD` and do no timezone maths

`src/lib/dates.ts` parses a bare `2026-08-30` as **local midnight on that
calendar day**, not UTC midnight. That is deliberate: `new Date("2026-08-30")`
is UTC midnight, which is the *previous day* everywhere west of Greenwich, so a
run backdated to "yesterday" would render as the day before that.

- Send `"2026-08-30"`. The server does the right thing with it.
- Do **not** convert to UTC, do **not** append `T00:00:00Z`, do **not** add an
  offset "to be safe". Every one of those re-introduces the off-by-one.
- A full ISO timestamp with an offset (`2026-08-30T21:15:00-07:00`) is passed
  through untouched. Use one only when the owner gave you a time of day.
- An **undated** run is the honest answer when nobody remembers. Its stored
  timestamps are the moment it was typed in and mean nothing; the `undated`
  flag is what tells every reader to ignore them, and the UI sorts those runs
  last.

## Runs

### Start one

```bash
npm run gx -- play start <ownedGameId>                       # from now
npm run gx -- play start <ownedGameId> --started-at 2026-08-29 --note "second playthrough"
```

```bash
curl -s -H "Authorization: Bearer $GAME_EXPLORER_TOKEN" -X POST "$GAME_EXPLORER_URL/api/games/<ownedGameId>/sessions" \
  -H 'content-type: application/json' -d '{ "startedAt": "2026-08-29" }'
# → 201 { id, ownedGameId, startedAt, endedAt: null, outcome: "playing", undated: false, note }
```

An empty body is legal and means "now" — the game page's Start button sends
exactly that.

Two things happen that you should not try to do yourself:

- **The copy's queue entry is deleted in the same transaction.** Up-next and
  in-progress are disjoint by construction; you never have to `queue remove`
  after starting a run, and doing it as a second request is how the two lists
  drift apart.
- **One open run per copy.** A second start on a copy that already has one is a
  **409** (`this copy already has a run in progress — finish it first`), with
  the offending id in `details.openSessionId`. It is enforced twice: by a check
  inside the transaction, and by a hand-written partial unique index
  (`prisma/migrations/20260831032612_one_open_run_per_copy`, which Prisma's
  schema language cannot express). **A 409 is an answer, not a hiccup — never
  retry it.** Finish or reopen the existing run instead.

### Record one that already happened

Same route; the presence of an end date is what makes it a past run.

```bash
npm run gx -- play log <ownedGameId> --started-at 2026-07-04 --ended-at 2026-07-19 --outcome completed
npm run gx -- play log <ownedGameId> --undated --outcome abandoned --note "sometime in the nineties"
```

```bash
curl -s -H "Authorization: Bearer $GAME_EXPLORER_TOKEN" -X POST "$GAME_EXPLORER_URL/api/games/<ownedGameId>/sessions" \
  -H 'content-type: application/json' \
  -d '{ "startedAt": "2026-07-04", "endedAt": "2026-07-19", "outcome": "completed" }'
```

- `startedAt` alone defaults to `endedAt` — a one-sitting run.
- `outcome` defaults to `completed`; the other value is `abandoned`.
- `outcome: "playing"` with an end date is a **400**. A finished run is not in
  progress; leave `endedAt` out if you meant to start one.
- `undated: true` together with either date is a **400** — send it on its own.
- An end before the start is a **400** (`a run cannot end before it started`).
- An unknown `ownedGameId` is a **404**.

**Use `gx play log`, not `gx play start`, for anything in the past.** They call
the same route and the API cannot tell which you meant: a `start` missing its
`--ended-at` opens a run that claims the owner is playing a game they finished
in 1997, and then blocks the next real run with a 409.

### Close, correct, reopen, delete

```bash
npm run gx -- play open                                   # every run in progress
npm run gx -- play list <ownedGameId>                     # one copy's runs
npm run gx -- play finish <sessionId> --outcome completed --ended-at 2026-08-30
npm run gx -- play edit <sessionId> --ended-at null       # reopen a mis-tapped finish
npm run gx -- play remove <sessionId>
```

```bash
curl -s -H "Authorization: Bearer $GAME_EXPLORER_TOKEN" -X PATCH "$GAME_EXPLORER_URL/api/sessions/<sessionId>" \
  -H 'content-type: application/json' -d '{ "outcome": "completed", "endedAt": "2026-08-30" }'
```

- `endedAt` defaults to **now** when you close a run. Pass the day the owner
  stated instead of letting today stand in for it — the default is right for a
  finger on the Finish button, not for dictation an hour later.
- **A run cannot be finished before it started: 400.** This is the one that
  will bite you, because it looks like a bug and is not. If you started the run
  with `gx play start` just now, its `startedAt` is *today*, and closing it
  with the owner's "I finished it on the 30th" is a date two days before the
  start. Two ways out, and which one is right depends on what the owner said:
  give the start its real date up front (`gx play start … --started-at
  2026-08-28`) or fix it after the fact (`gx play edit … --started-at
  2026-08-28`) — and if the whole run is in the past, it was never a `start` at
  all: use `gx play log` with both dates.
- The service keeps the outcome consistent with the dates: an open run is
  always `playing`, a closed one is never `playing`, and closing without an
  outcome records `completed`.
- `endedAt: null` reopens a run. It obeys the one-open-run rule, so it is a
  **409** if the copy has since started another.
- An **undated run cannot be reopened** — **400**, `an undated run cannot be
  reopened — give it dates first`. Its timestamps are the day it was recorded,
  so there is no moment to resume from.
- `undated` moves both ways. `undated: true` forgets the dates; `undated:
  false` is the "I remembered when that was" edit and must arrive **with** a
  real `startedAt` and `endedAt` (**400** otherwise). Sending dates alongside
  `undated: true` is also a **400**.
- `DELETE /api/sessions/<sessionId>` removes the run and **keeps its journal
  entries**, which survive with a null `sessionId`. Deleting a run never
  destroys the owner's writing. Delete only a run that should not exist — one
  you recorded wrongly, or one the owner says did not happen. Tidying somebody
  else's history is not your call.
- An unknown `sessionId` is a **404**.

## The queue

One list, global, ordered, dense positions `0..n-1`, capped at **50**.

```bash
npm run gx -- queue list
npm run gx -- queue add <ownedGameId> --note "co-op night"
npm run gx -- queue add <ownedGameId> --position 0            # straight to the top
npm run gx -- queue reorder --game <a> --game <b> --game <c>
npm run gx -- queue remove <ownedGameId>
```

```bash
curl -s -H "Authorization: Bearer $GAME_EXPLORER_TOKEN" -X POST "$GAME_EXPLORER_URL/api/queue" \
  -H 'content-type: application/json' -d '{ "ownedGameId": "…", "position": 0, "note": "co-op night" }'

curl -s -H "Authorization: Bearer $GAME_EXPLORER_TOKEN" -X PATCH "$GAME_EXPLORER_URL/api/queue" \
  -H 'content-type: application/json' -d '{ "orderedIds": ["…", "…", "…"] }'
```

- `POST /api/queue` takes `ownedGameId` **in the body** — the queue is one
  global list and has no `[id]` of its own. Posting a game that is already
  queued **moves** it rather than duplicating it.
- `position` is 0-based and splices. Omit it to append.
- **A copy with a run in progress cannot be queued: 400**, `this copy is
  already in progress — it cannot also be up next`, with the run's id in
  `details.openSessionId`. If the owner wants it back in the queue, finish or
  delete the run first.
- **The queue is full at 50: 409.** Not a retry — ask what to drop.
- `PATCH /api/queue` takes **the whole new order** and requires a
  **permutation of what is queued right now**: every queued id, exactly once.
  A missing id is a **400** (`the order must list exactly the games currently
  in the queue`, with `details.queued`), and a repeated one is a **400** (`the
  same game is listed twice`). This is on purpose — a stale list must not be
  able to delete an entry by leaving it out. So always `gx queue list --json`
  immediately before you reorder, and build the new order from what came back.
- `DELETE /api/queue/<ownedGameId>` removes one entry and closes the gap;
  **404** if it was not queued.
- Deleting an owned copy removes its queue entry too (`games.md`).

## Every route on this page

| Route | What it does | Refusals |
| --- | --- | --- |
| `GET /api/games/:id/sessions` | One copy's runs, newest first, undated last | 404 unknown copy |
| `POST /api/games/:id/sessions` | Start a run, or log a past/undated one | 409 already open · 400 bad dates/outcome · 404 unknown copy |
| `GET /api/sessions/open` | Every run in progress, newest first | — |
| `PATCH /api/sessions/:sessionId` | Finish, reopen, correct dates/outcome/note | 409 reopen conflict · 400 contradictory dates · 404 |
| `DELETE /api/sessions/:sessionId` | Delete a run; journal entries survive | 404 |
| `GET /api/queue` | The queue in order | — |
| `POST /api/queue` | Add, or move an existing entry | 400 run in progress · 409 full at 50 · 404 unknown copy |
| `PATCH /api/queue` | Set the whole order | 400 not a permutation |
| `DELETE /api/queue/:ownedGameId` | Remove one entry | 404 not queued |

All of them are behind `src/proxy.ts`, so every call needs the bearer token —
there is no public read here, unlike the image routes.

## Gotchas

- **No `gaps` endpoint, and there will not be one.** Every other domain has a
  "what is missing" listing because missing data is a research task. A missing
  run is not missing data — it is a game the owner has not played. There is
  nothing here to work through in bulk, and a bulk "mark everything played" is
  explicitly out of scope.
- **No timers, no durations, no automatic detection.** A run has a start and an
  end and nothing in between; nothing in this app watches a console or a
  library to decide you are playing something. Do not simulate it.
- **`PlaySession` and `QueueEntry` are in `db:snapshot`**, so they travel with
  a restore — unlike the map, manual, journal and music files, which are bytes
  on disk.
- **Read before you write.** `gx play list` and `gx queue list` are cheap and
  they are how you avoid a second run on a copy that already has one open, or
  a reorder built from an order that has since changed.

## Verify

```bash
npm run gx -- play open --json      # is the run you started actually open?
npm run gx -- queue list            # did the dequeue and the order land?
npm run gx -- play list <ownedGameId>
```

Then, in a browser: `/playing` shows in-progress runs and the up-next list, and
`/game/<id>` shows that copy's runs under **Play history**. A run you started
should appear on `/playing` and be gone from the queue on the same page.

## Report

Say, per game, exactly what you wrote and **where each date came from** — quote
the owner's own words for it if you can. Name anything you recorded `undated`
and say the date was not stated. If you asked for a date and did not get one,
say the run was not written rather than writing it with a guess. For the queue,
give the order you left it in. Never report a run you did not actually create,
and never present a run you inferred: if you found yourself reasoning towards a
date, the correct output is a question to the owner, not a row.
