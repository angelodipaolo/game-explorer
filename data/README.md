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
