# Running Game Explorer on the Mac mini

`https://games.angelodipaolo.com` is this app, served by `next start` on the
mini's own disk, reached through a Cloudflare Tunnel. Public read, owner write.
Nothing moved to a host, a hosted database or blob storage — the collection,
the images, the map scans and the journal photos are still files on the mini,
which is the whole reason this shape was chosen (GAMEEXPLOR-0002).

Three services, all surviving a reboot:

| Service | What | Runs as |
| --- | --- | --- |
| `com.angelodipaolo.game-explorer` | `npm run start` on port 3000 | LaunchAgent (your login) |
| `com.angelodipaolo.game-explorer-deploy` | polls GitHub, deploys `main` when it moves | LaunchAgent (your login) |
| `com.cloudflare.cloudflared` | the tunnel to Cloudflare's edge | LaunchDaemon (`cloudflared service install`) |

Templates in this directory are **not live config**: copy them into place and
edit the paths marked `CHECK`.

---

## 0. Before anything: the secrets

`.env` on the mini needs five variables beyond the IGDB pair. See
`.env.example` at the repo root for the full list.

```bash
cd ~/projects/game-explorer
# a long random string each; the password is what you type on your phone
openssl rand -base64 24   # AUTH_SECRET
openssl rand -hex 24      # one API token
```

Add to `.env` (never commit it, never print it):

```
OWNER_PASSWORD=…            # what you type at /login
AUTH_SECRET=…               # signs the 30-day session cookie
API_TOKENS=phone:…,skills:… # name:token pairs; delete a line to revoke one
```

`OWNER_PASSWORD` must be **long and random** — `openssl rand -base64 24`, kept
in your password manager. It is the one secret on this deployment that anyone
on the internet can sit and guess at, and a memorable password is the whole
attack.

Without `OWNER_PASSWORD` **and** `AUTH_SECRET`, the server fails closed: nobody
can sign in, every write is a 401, and one line appears in the log at first
request. That is deliberate — read `src/lib/auth.ts`. It fails closed in *every*
environment: the no-login open mode needs `AUTH_OPEN=1` explicitly set, which
`npm run dev` and the Playwright config do and nothing on the mini ever should.
`NODE_ENV` has no say in it, because `next start` does not set it.

Revoking access: delete a `name:token` pair from `API_TOKENS` to kill one
client, or rotate `AUTH_SECRET` to sign every browser out at once (nothing is
stored server-side, so every outstanding cookie stops verifying). Restart the
LaunchAgent after either.

### There is no rate limit on the login form

The app deliberately has no lockout and no counter on `/login` or
`/api/auth/*` — one password and a family-sized audience, and a counter here
would mostly be a way to lock the owner out of their own phone. On a public URL
that leaves password guessing unthrottled at the origin, so **put the limit at
the edge**, where it costs nothing and cannot lock you out of the app itself:

- Cloudflare → Security → **Rate limiting rules**: a rule matching
  `(http.request.uri.path eq "/login" or starts_with(http.request.uri.path, "/api/auth/"))`
  and `http.request.method eq "POST"`, at something like 10 requests per
  minute per IP, action *Block* for 10 minutes. Ten tries a minute is more than
  a human ever needs and takes a guessing run from millions of attempts a day
  to thousands.
- Or, if you would rather not think about it again: put **Cloudflare Access** in
  front of `/login` and `/api/auth/*` only. The plan rejected Access as the auth
  story for the whole site (the token has to keep working for the skills and a
  future iOS client) — as a lock on the sign-in path alone it does not conflict
  with that.

Either is a dashboard change, not a code change. Nothing in the app depends on
it, and nothing in the app substitutes for it.

---

## 1. The app as a service (Phase 4)

```bash
cd ~/projects/game-explorer
mkdir -p ~/Library/Logs/game-explorer

npm ci
npx prisma migrate deploy
npm run build

cp ops/com.angelodipaolo.game-explorer.plist ~/Library/LaunchAgents/
# check WorkingDirectory, PATH and the two log paths inside it first
launchctl bootstrap gui/$UID ~/Library/LaunchAgents/com.angelodipaolo.game-explorer.plist
launchctl kickstart -k gui/$UID/com.angelodipaolo.game-explorer

curl -sI localhost:3000/ | head -1        # 200
curl -s localhost:3000/api/tags           # {"error":"unauthorized"}
```

Verify what the plan asks for:

- **Reboot the mini** → `curl -s localhost:3000` answers with nothing typed.
- **`kill -9` the node process** → `KeepAlive` brings it back within seconds
  (`ThrottleInterval` is 10s, so a crash loop backs off rather than spins).

Day to day:

```bash
scripts/deploy.sh                                   # pull, install, backup, migrate, build, restart
launchctl print gui/$UID/com.angelodipaolo.game-explorer   # state, last exit code
tail -f ~/Library/Logs/game-explorer/err.log
launchctl bootout gui/$UID/com.angelodipaolo.game-explorer # stop it entirely
```

You mostly should not need `scripts/deploy.sh` by hand — see the next section.

**`next dev` and `next start` cannot share port 3000.** Develop in a different
checkout or worktree, or `npm run dev -- -p 3001`. (Next 16 keeps dev and
production build output apart — `.next/dev` and `.next/build` — so the two can
coexist in one directory on different ports, but only one `next dev` per
directory.)

Data and backups are unchanged by hosting: `prisma/dev.db`, `.cache/`,
`data/maps/`, `data/journal/` and `data/manuals/` all live in the checkout.
`npm run backup` captures the database and every blob directory in one archive;
`npm run db:snapshot` still exports the collection. Time Machine on the mini is
the other half. See `data/README.md`.

---

## 1b. The deploy timer — pushing to `main` is the deploy

`scripts/deploy.sh` still works and always will, but you should not have to open
a terminal on the mini to ship. `com.angelodipaolo.game-explorer-deploy` runs
`scripts/deploy-if-changed.sh` every 5 minutes: it fetches `origin/main`,
compares it to the local `main`, and calls `scripts/deploy.sh` only when the
remote is ahead. Push from the MacBook, walk away, and the mini has it inside
one interval.

The mini polls **outward**. There is no webhook endpoint, no port opened and no
CI runner executing repo-supplied workflow code on the machine that holds your
collection — the same trade as the tunnel. The cost is up to five minutes of
latency, which is not worth a new inbound surface.

```bash
cd ~/projects/game-explorer
cp ops/com.angelodipaolo.game-explorer-deploy.plist ~/Library/LaunchAgents/
# check WorkingDirectory, the script path, PATH and the log path inside it first
launchctl bootstrap gui/$UID ~/Library/LaunchAgents/com.angelodipaolo.game-explorer-deploy.plist

scripts/deploy-if-changed.sh                # run one tick by hand; safe, no-ops if nothing moved
tail -f ~/Library/Logs/game-explorer/deploy.log
```

What it will and will not do:

- **`main` only.** The branch is named explicitly, never taken from HEAD. A
  feature branch advancing on origin does nothing. If it ever finds HEAD
  somewhere other than `main` it logs that loudly and switches back — so the
  timer effectively *owns* the checkout's branch.
- **Nothing when nothing changed.** The common tick is one `git fetch` and a
  `no change` line. No build, no restart, no downtime.
- **One deploy at a time.** A lockfile
  (`~/Library/Logs/game-explorer/deploy.lock`) means a tick landing mid-build
  logs and leaves rather than stacking a second `npm ci` on the first.
- **Refuses a dirty tree**, and refuses when `origin/main` is not a
  fast-forward (a force-push, or commits made on the mini). Both are logged and
  left for a human; nothing is discarded.
- **Fails loud but non-fatal.** A broken build leaves the LaunchAgent serving
  the build it already has, and `deploy.sh` has already taken a backup before
  the migrate step. The log records the exit code; the next tick retries, so a
  fixing push recovers on its own.

The log is `~/Library/Logs/game-explorer/deploy.log`, timestamped, with
`deploy.sh`'s own output inline:

```
2026-08-31T15:40:02-0700  no change (main at 94a75ce)
2026-08-31T15:45:03-0700  deploying 94a75ce..1f3c9d0 (2 commit(s)) — GAMEEXPLOR-0013: …
2026-08-31T15:47:41-0700  deployed 1f3c9d0 in 158s
```

`~/Library/Logs/game-explorer/deploy-launchd.err.log` should stay near-empty —
it only catches failures before the script starts logging (a bad path in the
plist, a shell that cannot start).

### Pause it before you touch the checkout by hand

Hand-deploying, rolling back to an older SHA, or testing a branch on the mini
all race the timer, and the timer wins: within one interval it drags the
checkout back to `main`. Stop it first.

```bash
launchctl bootout gui/$UID/com.angelodipaolo.game-explorer-deploy   # pause
# … git checkout <sha>; scripts/deploy.sh; poke at it …
launchctl bootstrap gui/$UID ~/Library/LaunchAgents/com.angelodipaolo.game-explorer-deploy.plist   # resume
```

A bootout lasts until you bootstrap it again **or until the mini reboots** —
launchd loads everything in `~/Library/LaunchAgents` at login. So do not rely on
it as an off switch for anything longer than an afternoon; to disable the timer
for real, move the plist out of that directory. The better rollback
is still a `git revert` pushed to `main`: the timer ships it unattended, and the
mini stays a machine nobody has to log into.

---

## 2. The tunnel and the domain (Phase 5)

DNS for `angelodipaolo.com` is already on Cloudflare (`piper`/`rodrigo`
nameservers) and Netlify keeps serving the root site. This only adds a
`games.` record pointing at the tunnel.

```bash
brew install cloudflared

cloudflared tunnel login                    # browser: pick angelodipaolo.com
cloudflared tunnel create game-explorer     # prints the UUID + credentials file
cloudflared tunnel route dns game-explorer games.angelodipaolo.com

cp ~/projects/game-explorer/ops/cloudflared.yml ~/.cloudflared/config.yml
# put the UUID from `tunnel create` into credentials-file
cloudflared tunnel ingress validate

sudo cloudflared service install             # LaunchDaemon, survives reboot
sudo launchctl print system/com.cloudflare.cloudflared | head
```

In the Cloudflare dashboard for `angelodipaolo.com`:

- SSL/TLS mode: **Full**
- **Always Use HTTPS**: on (the app's own redirects are `http` because
  `cloudflared` forwards over http; the edge upgrades them)
- One **rate-limiting rule** on `/login` and `/api/auth/*` — see "There is no
  rate limit on the login form" above. This is the only throttle guarding the
  owner password; the app has none.
- Nothing else. No WAF rules, no site-wide Access policy — the plan rejected
  Access as the auth story on purpose.

Verify, from a phone **off wifi**:

```bash
curl -I https://games.angelodipaolo.com/          # 200, x-robots-tag: noindex, nofollow
curl -s  https://games.angelodipaolo.com/robots.txt   # Disallow: /
curl -s -o /dev/null -w '%{http_code}\n' \
  -X PUT https://games.angelodipaolo.com/api/games/anything/tags   # 401
curl -s -o /dev/null -w '%{http_code}\n' \
  -H "Authorization: Bearer $GAME_EXPLORER_TOKEN" \
  https://games.angelodipaolo.com/api/tags                          # 200
```

### What a visitor can read

Everything except the curation pages, and that is the design. Anyone with the
link — or with a guessed URL — can read the whole collection **and the personal
part of it**: journal entries and their photos, private notes, play sessions and
dates, bookmarks. The image routes (`/api/maps/:id/image`,
`/api/journal/:id/image`, `/api/manual-pages/:id/image`) are public by
necessity so the pages render for a signed-out visitor, and no `cache-control`
header changes that. **Do not put anything in a journal entry, a note or a photo
that you would mind a stranger reading.** Write is the only thing auth protects.

Then in Safari: shelf → filter → flip → open a game (no edit controls) →
filter sheet → **Sign in** → the same game now has "+ tag", "+ code", the
journal composer and the play buttons. Close Safari, come back tomorrow: still
signed in (the cookie is 30 days).

Reboot the mini once more and check both services come back with nothing typed.

---

## 3. Agents and scripts against the public URL

Every `/api/*` call needs a token. The skills under `.claude/skills/` already
read these two variables:

```bash
export GAME_EXPLORER_URL=https://games.angelodipaolo.com
export GAME_EXPLORER_TOKEN=…        # one of the API_TOKENS values
```

Unset, they default to `http://localhost:3000` with no token, which is exactly
what a local `npm run dev` wants. A skill that gets a `401` is told to stop and
say so rather than retry.

---

## When something is wrong

| Symptom | Look at |
| --- | --- |
| Site is down, tunnel is up | `tail ~/Library/Logs/game-explorer/err.log`; `launchctl print gui/$UID/com.angelodipaolo.game-explorer` |
| `error 1033` / tunnel error page | `sudo launchctl print system/com.cloudflare.cloudflared`; `cloudflared tunnel info game-explorer` |
| Every write 401s, sign-in refused | `OWNER_PASSWORD`/`AUTH_SECRET` missing from `.env` — the log says which |
| Signed out on every request | the cookie is `Secure` only over https; check Cloudflare is not serving the origin over plain http |
| A new API route is somehow public | it is not: `src/proxy.ts` gates `/api/*` wholesale. If you exempted it there, undo that |
| Covers are blank for visitors | the `/api/img/*` allowlist in `src/proxy.ts` — it must stay public |
| A push to `main` never went live | `tail ~/Library/Logs/game-explorer/deploy.log` — it says what it saw. Then `launchctl print gui/$UID/com.angelodipaolo.game-explorer-deploy` |
| The timer keeps refusing | the log names it: dirty tree, HEAD off `main`, or a non-fast-forward `origin/main`. All want a human, none discard anything |
| A hand-deploy got reverted minutes later | the timer put the checkout back on `main`. `bootout` it first next time — see §1b |
| `deploy.lock` looks stuck | it holds a pid; if that process is gone the next tick reclaims it. `rm -rf ~/Library/Logs/game-explorer/deploy.lock` if you are sure no deploy is running |

Rolling back a bad deploy is a `git revert` pushed to `main` — the timer ships
it. (A local `git checkout` plus `scripts/deploy.sh` still works, but bootout the
timer first or it will pull you forward again.) Rolling back bad *data* is
`npm run backup`'s archive, or an import batch rollback.
