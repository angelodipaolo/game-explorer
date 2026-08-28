# Game Explorer

Browse the shelf, pick a game. A local-first web app for a physical game
collection: cover art, filters that work with sparse data, a way to flip
through matches across the room, and a game page that answers "should we play
this?"

## Run it

```bash
cp .env.example .env      # add your Twitch/IGDB credentials
npm install
npm run db:restore        # builds prisma/dev.db from the committed snapshot
npm run dev
```

The dev server binds to `0.0.0.0`, so anything on the same wifi can open it.
Find your machine's LAN address and share it:

```bash
ipconfig getifaddr en0    # macOS — e.g. 192.168.1.42
```

Then open `http://192.168.1.42:3000` on a phone. No login.

## Checks

```bash
npm run check        # lint + typecheck + unit tests + build
npm run test:e2e     # Playwright, desktop and phone projects
```

See `AGENTS.md` for the architecture constraints and the skills under
`.claude/skills/` for importing and enrichment.
