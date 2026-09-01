/**
 * The pure half of `npm run db:snapshot` (GAMEEXPLOR-0034): which import
 * sessions belong in the export, and whether the object about to be written
 * can actually be restored.
 *
 * Nothing here touches Prisma or the filesystem, so both rules can be pinned
 * down in unit tests — which matters, because both of them fail *silently*.
 * A snapshot is only ever proved wrong by a restore, and a restore normally
 * happens on a different machine, days later, when the state that produced the
 * bad export is long gone.
 */

/** A row as the snapshot holds it: JSON-ish, keyed by column name. */
type Row = Readonly<Record<string, unknown>>;

/** The snapshot object itself — table name to rows, plus scalar metadata. */
export type SnapshotLike = Readonly<Record<string, unknown>>;

function rowsOf(snapshot: SnapshotLike, table: string): readonly Row[] {
  const value = snapshot[table];
  return Array.isArray(value) ? (value as readonly Row[]) : [];
}

// ---------------------------------------------------------------------------
// Selection: which import scaffolding is worth exporting
// ---------------------------------------------------------------------------

/**
 * Whether an import session belongs in the snapshot.
 *
 * The original rule was "committed sessions only" — the scaffolding of a half
 * finished import is throwaway, and there is no reason for the owner's export
 * to carry a session someone abandoned mid-review.
 *
 * That rule was wrong in one specific, *ordinary* way. `rollbackBatch`
 * (`src/lib/import/service.ts`) marks the batch `rolled_back` and resets its
 * session to `open` in the same transaction, so **every undo of an import
 * leaves an open session that still owns a batch**. Under the old rule the
 * batch was exported (all batches were) while its session was filtered out,
 * and `db:restore` died on `ImportBatch.sessionId`'s foreign key. Not stray
 * scaffolding in one unlucky checkout: anyone who has ever rolled back an
 * import had an unrestorable snapshot and no way to know it.
 *
 * So the rule is now "committed **or** owns a batch". A batch is the unit of
 * undo and `OwnedGame.importBatchId` is the provenance of every game an import
 * created; dropping batches and nulling those references would have fixed the
 * foreign key by destroying the history it exists to record. Uncommitted
 * scaffolding with *no* batch still stays out, which keeps the original intent
 * intact — the only sessions that were added back are the ones something else
 * in the snapshot already points at.
 */
export function isExportedSession(session: { readonly status: string }, hasBatch: boolean): boolean {
  return session.status === "committed" || hasBatch;
}

/** Apply {@link isExportedSession} to a whole table, given every batch there is. */
export function selectImportSessions<S extends { id: string; status: string }>(
  sessions: readonly S[],
  batches: readonly { sessionId: string }[],
): S[] {
  const withBatch = new Set(batches.map((b) => b.sessionId));
  return sessions.filter((s) => isExportedSession(s, withBatch.has(s.id)));
}

/**
 * Rows follow their session exactly.
 *
 * They have to: `ImportRow.sessionId` is a foreign key, so exporting a row
 * whose session was filtered out is the same failure one table over. Following
 * the session rather than filtering independently is also what keeps an
 * exported session from restoring as a hollow shell — a rolled-back import
 * whose rows were dropped would look, in the restored copy, like an import of
 * nothing.
 */
export function selectImportRows<R extends { sessionId: string }>(
  rows: readonly R[],
  exportedSessions: readonly { id: string }[],
): R[] {
  const ids = new Set(exportedSessions.map((s) => s.id));
  return rows.filter((r) => ids.has(r.sessionId));
}

// ---------------------------------------------------------------------------
// Self-consistency: an export that cannot be restored is not an export
// ---------------------------------------------------------------------------

/** One foreign key, as the snapshot sees it. */
export type Reference = {
  /** Snapshot key holding the child rows, e.g. "importBatches". */
  readonly from: string;
  /** Column on the child that points at a parent, e.g. "sessionId". Null is fine. */
  readonly field: string;
  /** Snapshot key holding the parent rows, e.g. "importSessions". */
  readonly to: string;
  /** Column the parent is keyed by — "id" everywhere except CatalogGame's `igdbId`. */
  readonly parentKey?: string;
};

/**
 * Every foreign key in `prisma/schema.prisma`, in snapshot terms.
 *
 * Keep it in step with the schema by hand: a new `@relation(fields: [...])` is
 * a new line here, the same standing rule as the table lists in
 * `scripts/db-snapshot.ts` and `scripts/db-restore.ts`. A relation missing from
 * this list is not a crash — it is simply unchecked, which is exactly the state
 * the whole file exists to end.
 */
export const REFERENCES: readonly Reference[] = [
  // The import chain — the one this check was written for.
  { from: "importRows", field: "sessionId", to: "importSessions" },
  { from: "importBatches", field: "sessionId", to: "importSessions" },
  { from: "importEffects", field: "batchId", to: "importBatches" },
  { from: "importEffects", field: "ownedGameId", to: "ownedGames" },
  { from: "ownedGames", field: "importBatchId", to: "importBatches" },
  { from: "ownedGames", field: "catalogGameId", to: "catalogGames", parentKey: "igdbId" },
  // Everything hanging off one owned copy.
  { from: "gameFacts", field: "ownedGameId", to: "ownedGames" },
  { from: "gameTags", field: "ownedGameId", to: "ownedGames" },
  { from: "gameCodes", field: "ownedGameId", to: "ownedGames" },
  { from: "gameMaps", field: "ownedGameId", to: "ownedGames" },
  { from: "mapMarkers", field: "mapId", to: "gameMaps" },
  { from: "gameBookmarks", field: "ownedGameId", to: "ownedGames" },
  { from: "gameManuals", field: "ownedGameId", to: "ownedGames" },
  { from: "manualPages", field: "manualId", to: "gameManuals" },
  { from: "musicTracks", field: "ownedGameId", to: "ownedGames" },
  { from: "playSessions", field: "ownedGameId", to: "ownedGames" },
  { from: "journalEntries", field: "ownedGameId", to: "ownedGames" },
  { from: "journalEntries", field: "sessionId", to: "playSessions" },
  { from: "queueEntries", field: "ownedGameId", to: "ownedGames" },
  // Series membership is by IGDB id and deliberately has no foreign key to the
  // catalog (an entry may name a game IGDB has never heard of), so only the
  // series itself is checked here.
  { from: "seriesEntries", field: "seriesId", to: "series" },
];

/*
 * Deliberately NOT in the list above: `ImportRow.dedupeTargetId`. It looks
 * exactly like a foreign key and is not one — it points at an `OwnedGame` on
 * some rows and at another `ImportRow` on others, with nothing in the row
 * saying which. Adding it here is the single edit that would turn this check
 * from a safety net into a false-failure generator, blocking every export on a
 * database that is perfectly restorable. If a future relation is genuinely
 * polymorphic, leave it out and say so here, the way this paragraph does.
 */

/** A child row pointing at a parent the snapshot does not contain. */
export type DanglingReference = {
  readonly table: string;
  readonly field: string;
  readonly rowId: string;
  readonly parentTable: string;
  readonly missingId: string;
};

/**
 * Every reference in the snapshot that does not resolve inside the snapshot.
 *
 * This is the general form of the bug in GAMEEXPLOR-0034, and the reason it is
 * written as a sweep over a table of relations rather than as one guard against
 * one filter: the specific bug was a *filter* (committed sessions only) that
 * left a *pointer* (a rolled-back batch) with nothing to point at, and any
 * future filter, `where` clause or forgotten table can do the same thing again.
 * A restore is one big `createMany` per table inside a transaction, so the cost
 * of that mistake is not a bad row — it is the whole restore aborting, at the
 * moment the owner most needs it, on a machine where the database that produced
 * the export no longer exists.
 *
 * Checking at export time is what turns that into a loud failure while the
 * information is still in front of you.
 */
export function findDanglingReferences(snapshot: SnapshotLike, references: readonly Reference[] = REFERENCES): DanglingReference[] {
  const dangling: DanglingReference[] = [];
  for (const ref of references) {
    const parentKey = ref.parentKey ?? "id";
    const parents = new Set(rowsOf(snapshot, ref.to).map((p) => p[parentKey]));
    for (const row of rowsOf(snapshot, ref.from)) {
      const value = row[ref.field];
      // A null foreign key is a fact, not a gap: an owned game with no import
      // batch was added by hand, and a journal entry with no play session was
      // written outside a run.
      if (value === null || value === undefined) continue;
      if (parents.has(value)) continue;
      dangling.push({
        table: ref.from,
        field: ref.field,
        rowId: String(row.id ?? "(no id)"),
        parentTable: ref.to,
        missingId: String(value),
      });
    }
  }
  return dangling;
}

/** One dangling reference, in the words the export fails with. */
export function describeDangling(d: DanglingReference): string {
  return `${d.table} ${d.rowId}: ${d.field}=${d.missingId} is not in ${d.parentTable}`;
}

/** Thrown instead of writing a snapshot that `db:restore` would choke on. */
export class UnrestorableSnapshotError extends Error {
  constructor(readonly dangling: readonly DanglingReference[]) {
    super(
      [
        `snapshot is not self-consistent: ${dangling.length} dangling reference(s) — nothing was written.`,
        ...dangling.map((d) => `  ${describeDangling(d)}`),
        "Every foreign key in the export must resolve inside the export; restoring this would fail on the FK.",
      ].join("\n"),
    );
    this.name = "UnrestorableSnapshotError";
  }
}

/**
 * Fail the export rather than write a snapshot that cannot be restored.
 *
 * Call it after the snapshot object is built and **before** the file is
 * written: a half-good `data/snapshot.json` on disk is worse than none, because
 * it looks exactly like a good one until the day it is needed.
 */
export function assertRestorable(snapshot: SnapshotLike, references: readonly Reference[] = REFERENCES): void {
  const dangling = findDanglingReferences(snapshot, references);
  if (dangling.length) throw new UnrestorableSnapshotError(dangling);
}
