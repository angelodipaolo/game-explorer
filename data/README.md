# data/

`snapshot.json` is a full export of your database (games, catalog cache,
imports, facts, tags). It is **gitignored** — your collection is yours — and
lives only on your machine. Back it up somewhere private.

- `npm run db:snapshot` writes it from `prisma/dev.db`.
- `npm run db:restore` rebuilds `prisma/dev.db` from it.

Starting fresh (no snapshot): `npm run db:migrate`, then import games via
`/import` (CSV drop) or the `import-collection` skill.

`maps/` holds the image behind each interactive map (`<GameMap id>.png` or
`.jpg`), written by `PUT /api/maps/:id/image`. It is gitignored and **not part
of the snapshot** — the snapshot carries the map rows and markers, the files
carry the pixels. Back the directory up together with `snapshot.json`; a
restore without it leaves each map showing "no image" until it is re-uploaded.

`journal/` holds the photo behind each journal entry (`<JournalEntry id>.jpg`
or `.png`), written by `PUT /api/journal/:entryId/image`. Same stance as
`maps/`: gitignored and **not part of the snapshot** — the snapshot carries the
entries, the files carry the pixels. Play sessions, journal entries and the
play queue *are* in the snapshot.

## Backups

`npm run backup` writes `backups/game-explorer-<ISO8601>.tar.gz` — the one
command that captures everything personal at once. It refreshes
`data/snapshot.json`, copies `prisma/dev.db` with SQLite's `VACUUM INTO` (safe
to run while `npm run dev` is serving; a plain file copy of a live database is
not), and archives both alongside `data/maps/` and `data/journal/`.

`npm run backup -- --out ~/Documents/backups` puts the archive somewhere that
is not this machine. `backups/` is gitignored — an archive is never committed.

Restoring from one:

1. `tar -xzf game-explorer-<stamp>.tar.gz` — you get a
   `game-explorer-<stamp>/` directory holding `dev.db` and `data/`.
2. Copy `dev.db` to `prisma/dev.db`.
3. Copy `data/` over this repo's `data/` (snapshot.json, `maps/`, `journal/`).
4. `npx prisma migrate deploy` to bring the restored database up to the current
   schema. Not `npm run db:migrate` — that is `migrate dev`, which is
   interactive and can offer to reset the database you are trying to restore.

If only `data/` survived, skip steps 2–3 and run `npm run db:restore`, which
rebuilds `prisma/dev.db` from `snapshot.json`; the `maps/` and `journal/`
files come back from the archive.
