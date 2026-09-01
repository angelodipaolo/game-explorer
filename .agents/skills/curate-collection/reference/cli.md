# The `gx` CLI

See `SKILL.md` for the env/auth preamble — do not skip it.

`gx` is the front door to every write path in this app. It ships in the repo,
wraps the same REST API the other reference files document, and is the
recommended way to drive it. `curl` still works and stays documented — the
payload shapes in the other files are the payloads `gx` sends — but the CLI is
what you should reach for first, because the guardrails are in its code rather
than in prose you have to remember.

## Running it

There is nothing to install. From a checkout of this repo:

```bash
npm run gx -- --help                    # the groups
npm run gx -- codes --help              # the commands in one group
npm run gx -- codes add --help          # one command's arguments and flags
```

The `--` matters: it is what stops npm from eating the flags. Every command is
one HTTP call to `$GAME_EXPLORER_URL` — the CLI never opens a database, never
reads `prisma/dev.db`, and never touches the filesystem except to stream a file
you named on the command line to an upload route.

**The help is generated from the command table** (`src/lib/gx/registry.ts`),
so it cannot drift from what the commands actually do. If `--help` and this
file ever disagree, believe `--help`.

## The two environment variables

```bash
GAME_EXPLORER_URL      # which collection you are writing to. No default, ever.
GAME_EXPLORER_TOKEN    # one of the server's API tokens, from its .env (API_TOKENS)
```

Both live in the owner's `~/.zshenv`, so they are already in your environment.
If either is unset, `gx` stops with exit code 2 and says which one — it does
**not** fall back to anything. That refusal is the whole point: an agent that
guessed `localhost` once wrote a game to a throwaway dev database and reported
success, and nobody found out until the owner went looking for it on their
shelf.

## Guardrails, enforced in code

- **No fallback target.** `GAME_EXPLORER_URL` unset is a stop, not a hint.
- **Loopback is refused.** A `localhost`, `127.0.0.x`, `::1` or `0.0.0.0`
  target exits 2 unless `--dev` is passed **on that exact invocation**. There
  is no env var or config file that turns it on permanently, because a guard
  you can switch on and forget is a guard that is off.
- **Every write announces its target first.** A mutating command prints
  `→ POST http://cids-Mac-mini.local:3000/api/games/…` to stderr *before* it
  sends, so the host being changed is visible even if the command dies halfway.
- **A 401 is never retried.** It means the token is missing or wrong. `gx`
  prints it and exits; fix the token, do not loop.
- **The API's error is printed verbatim.** "already at the 30-code limit",
  "set by hand; agents never overwrite manual facts",
  `unknown platform "nintendo 65"` — those messages tell you what to do next,
  so nothing paraphrases them.

## `--json` and exit codes

`--json` works on every command and prints the API's JSON **verbatim** to
stdout with nothing else on that stream — pipe it straight into `jq` or
`python3 -c`. Human-readable output is the default. The `→ METHOD <url>` line
and every error go to stderr, so they never pollute a pipe.

| exit | meaning |
| --- | --- |
| `0` | the API answered 2xx |
| `1` | the API refused — its own error message is on stderr |
| `2` | a usage problem: unknown command, missing argument, missing env var, refused localhost. **Nothing was sent**, so nothing changed |

Three more flags are global: `--dev` (above), `--raw` (write the bytes of an
image or audio read to stdout instead of a summary), and `--help`.

## Batch bodies

The batch endpoints — `codes write`, `bookmarks write`, `facts write`,
`tags write`, `maps markers`, `series create`, `series add-entries`,
`import add-rows` — take the whole JSON body with `--body`. Use `--body -` to
read it from stdin, which is how a 200-row batch gets in without fighting a
shell's quoting:

```bash
python3 build-codes.py | npm run gx -- codes write --body -
```

Named flags merge on top of a `--body`, so `--body '{"markers":[…]}' --replace`
is a legal thing to type.

## A worked example: name → id → write

Every reference file except `games.md` starts with "you have an
`ownedGameId`". This is how you get one, and what it looks like end to end.

```bash
# 1. Turn a name into an id. Both ids come back: ownedGameId for anything
#    hung off a copy, igdbId for series entries.
npm run gx -- games search castlevania --platform nes --json
# {"games":[{"ownedGameId":"cmti3bi…","igdbId":1097,"name":"Castlevania",
#            "platform":"nes","platformLabel":"NES","quantity":1,…}],"nextCursor":null}

# 2. Look before you write — `counts` says what is already there.
npm run gx -- games show cmti3bi…
# counts:
#   codes: 0   maps: 0   bookmarks: 0   manuals: 0   tags: 0   music: 0

# 3. Write. The arrow line is stderr, printed before the request goes out.
npm run gx -- codes add cmti3bi… \
  --kind game-genie --effect "Infinite lives" --code SXIOPO \
  --source-url "https://gamehacking.org/…"
# → POST http://cids-Mac-mini.local:3000/api/games/cmti3bi…/codes

# 4. Read it back.
npm run gx -- codes list cmti3bi…
```

Research writes go through a run, so the report means something:

```bash
RUN=$(npm run gx --silent -- enrichment start --label "metroidvania pass" --json | jq -r .id)
npm run gx -- tags write "$RUN" --body '{"tags":[{"ownedGameId":"cmti3bi…","tag":"Metroidvania","sourceUrl":"https://…"}]}'
# written (1): …
# skipped (0): (none)      ← always read this; a manual tag is skipped, not overwritten
npm run gx -- enrichment finish "$RUN"
```

## What has no command

`gx` deliberately has no command for `/api/auth/*` (the owner's browser
session), `/api/img/*` (the shelf's pixels), the journal routes, the play
sessions or the queue. The last three have **no agent write path by design** —
see "Never write these" in `SKILL.md`. Their absence from `--help` is the
refusal, in code.
