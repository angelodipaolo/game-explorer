# Running Game Explorer on the Mac mini

`https://games.angelodipaolo.com` is this app, served by `next start` on the
mini's own disk, reached through a Cloudflare Tunnel. Public read, owner write.
Nothing moved to a host, a hosted database or blob storage — the collection,
the images, the map scans and the journal photos are still files on the mini,
which is the whole reason this shape was chosen (GAMEEXPLOR-0002).

Two services, both surviving a reboot:

| Service | What | Runs as |
| --- | --- | --- |
| `com.angelodipaolo.game-explorer` | `npm run start` on port 3000 | LaunchAgent (your login) |
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

Rolling back a bad deploy is a git checkout plus `scripts/deploy.sh`; rolling
back bad *data* is `npm run backup`'s archive, or an import batch rollback.
