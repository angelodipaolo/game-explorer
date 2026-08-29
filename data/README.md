# data/

`snapshot.json` is a full export of your database (games, catalog cache,
imports, facts, tags). It is **gitignored** — your collection is yours — and
lives only on your machine. Back it up somewhere private.

- `npm run db:snapshot` writes it from `prisma/dev.db`.
- `npm run db:restore` rebuilds `prisma/dev.db` from it.

Starting fresh (no snapshot): `npm run db:migrate`, then import games via
`/import` (CSV drop) or the `import-collection` skill.
