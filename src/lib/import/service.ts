import type { ImportRow, ImportSession, Prisma } from "@prisma/client";
import { liveCatalog, type CatalogPort, type MatchCandidate } from "@/lib/catalog";
import { decide } from "@/lib/catalog";
import { normalizeTitle } from "@/lib/catalog/normalize";
import { prisma } from "@/lib/db";
import { resolvePlatform } from "@/lib/platforms";
import type { CreateSessionInput, DecideRowInput, ImportRowInput } from "./schema";

/**
 * Staged import. Nothing touches OwnedGame until commit; commit is one
 * transaction that logs every write as an ImportEffect so rollback can undo
 * exactly that batch.
 *
 * Row decisions:
 *   auto     — matcher was confident; will be linked on commit
 *   review   — held; holdReason says why. Blocks commit unless forced.
 *   accepted — a person/agent settled it (with or without an igdbId)
 *   merge    — folds into an existing owned game (quantity added)
 *   dropped  — left out
 */

export class ImportError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "ImportError";
  }
}

export type Deps = { catalog: CatalogPort };

function deps(overrides?: Partial<Deps>): Deps {
  return { catalog: overrides?.catalog ?? liveCatalog() };
}

type Prepared = {
  input: ImportRowInput;
  title: string;
  normalizedTitle: string;
  platform: string;
  quantity: number;
  problems: string[];
};

function prepare(input: ImportRowInput, defaultPlatform: string | null): Prepared {
  const problems: string[] = [];
  const title = input.title.replace(/\s+/g, " ").trim();
  const wanted = input.platform?.trim() || defaultPlatform || "";
  const platform = resolvePlatform(wanted);
  if (!platform) problems.push(wanted ? `unknown platform "${wanted}"` : "no platform given and no default");
  return {
    input,
    title,
    normalizedTitle: normalizeTitle(title),
    platform: platform?.slug ?? (wanted ? normalizeTitle(wanted).replace(/\s/g, "-") : "unknown"),
    quantity: input.quantity ?? 1,
    problems,
  };
}

export async function createSession(input: CreateSessionInput, d?: Partial<Deps>): Promise<ImportSession & { rows: ImportRow[] }> {
  const session = await prisma.importSession.create({
    data: { label: input.label, source: input.source },
  });
  if (input.rows.length) await addRows(session.id, input.rows, input.defaultPlatform ?? null, d);
  return getSession(session.id);
}

export async function getSession(id: string) {
  const session = await prisma.importSession.findUnique({ where: { id }, include: { rows: { orderBy: { index: "asc" } }, batch: true } });
  if (!session) throw new ImportError("session not found", 404);
  return session;
}

export async function listSessions() {
  return prisma.importSession.findMany({
    orderBy: { createdAt: "desc" },
    include: { batch: true, _count: { select: { rows: true } } },
  });
}

/** Validate, dedupe and match a batch of rows into an open session. */
export async function addRows(sessionId: string, inputs: ImportRowInput[], defaultPlatform: string | null, d?: Partial<Deps>): Promise<ImportRow[]> {
  const { catalog } = deps(d);
  const session = await getSession(sessionId);
  if (session.status !== "open") throw new ImportError(`session is ${session.status}`, 409);

  const existingRows = session.rows;
  let index = existingRows.length ? Math.max(...existingRows.map((r) => r.index)) + 1 : 0;
  const seen = new Map<string, string>(); // normalizedTitle|platform -> row id, within session
  for (const r of existingRows) if (r.decision !== "dropped") seen.set(`${r.normalizedTitle}|${r.platform}`, r.id);

  const created: ImportRow[] = [];
  for (const input of inputs) {
    const p = prepare(input, defaultPlatform);
    const key = `${p.normalizedTitle}|${p.platform}`;
    const data: Prisma.ImportRowUncheckedCreateInput = {
      sessionId,
      index: index++,
      input: JSON.stringify(input),
      title: p.title,
      normalizedTitle: p.normalizedTitle,
      platform: p.platform,
      quantity: p.quantity,
      problems: JSON.stringify(p.problems),
      decision: "review",
    };

    if (p.problems.length) {
      data.holdReason = "invalid";
    } else if (seen.has(key)) {
      // Same title twice in one submission: fold into the first occurrence.
      data.dedupeKind = "in-session";
      data.dedupeTargetId = seen.get(key)!;
      data.decision = "merge";
      data.decidedBy = "api";
    } else {
      const existing = await prisma.ownedGame.findUnique({ where: { normalizedTitle_platform: { normalizedTitle: p.normalizedTitle, platform: p.platform } } });
      if (existing) {
        data.dedupeKind = "existing";
        data.dedupeTargetId = existing.id;
        data.holdReason = "duplicate";
      } else if (input.igdbId) {
        data.chosenIgdbId = input.igdbId;
        data.chosenConfidence = 1;
        data.decision = "accepted";
        data.decidedBy = "agent";
      } else {
        const candidates = await catalog.candidates(p.title, p.platform);
        data.candidates = JSON.stringify(candidates);
        const verdict = decide(candidates);
        if (verdict.kind === "auto") {
          data.decision = "auto";
          data.decidedBy = "api";
          data.chosenIgdbId = verdict.candidate.igdbId;
          data.chosenConfidence = verdict.candidate.confidence;
        } else {
          data.holdReason = verdict.kind;
        }
      }
    }
    const row = await prisma.importRow.create({ data });
    if (row.decision !== "dropped" && !seen.has(key)) seen.set(key, row.id);
    created.push(row);
  }
  await prisma.importSession.update({ where: { id: sessionId }, data: { updatedAt: new Date() } });
  return created;
}

export async function decideRow(sessionId: string, rowId: string, input: DecideRowInput): Promise<ImportRow> {
  const session = await getSession(sessionId);
  if (session.status !== "open") throw new ImportError(`session is ${session.status}`, 409);
  const row = session.rows.find((r) => r.id === rowId);
  if (!row) throw new ImportError("row not found", 404);

  const data: Prisma.ImportRowUncheckedUpdateInput = { decision: input.decision, decidedBy: input.decidedBy, holdReason: null };
  if (input.title || input.platform) {
    const p = prepare({ ...(JSON.parse(row.input) as ImportRowInput), title: input.title ?? row.title, platform: input.platform ?? row.platform }, null);
    if (p.problems.length) throw new ImportError(p.problems.join("; "), 400);
    data.title = p.title;
    data.normalizedTitle = p.normalizedTitle;
    data.platform = p.platform;
    data.problems = "[]";
  }
  if (input.quantity) data.quantity = input.quantity;

  if (input.decision === "merge") {
    if (!row.dedupeTargetId) throw new ImportError("row has nothing to merge into", 400);
  } else if (input.decision === "accepted") {
    if (input.igdbId !== undefined) {
      data.chosenIgdbId = input.igdbId;
      const cand = (JSON.parse(row.candidates) as MatchCandidate[]).find((c) => c.igdbId === input.igdbId);
      data.chosenConfidence = input.igdbId == null ? null : (cand?.confidence ?? 1);
    } else if (row.dedupeKind === "existing") {
      throw new ImportError("row collides with an owned game: choose merge or dropped, or accept with a different title", 400);
    }
  }
  return prisma.importRow.update({ where: { id: rowId }, data });
}

export async function discardSession(sessionId: string) {
  const session = await getSession(sessionId);
  if (session.status === "committed") throw new ImportError("committed sessions are rolled back, not discarded", 409);
  return prisma.importSession.update({ where: { id: sessionId }, data: { status: "discarded" } });
}

export type CommitResult = {
  batchId: string;
  created: number;
  merged: number;
  dropped: number;
  unlinked: number;
  catalog: { full: number; stubs: number };
};

/**
 * One transaction. Every write is logged as an ImportEffect. Catalog sync
 * (IGDB) happens before the transaction so a network failure leaves nothing
 * half-written.
 */
export async function commitSession(sessionId: string, opts: { force?: boolean } = {}, d?: Partial<Deps>): Promise<CommitResult> {
  const { catalog } = deps(d);
  const session = await getSession(sessionId);
  if (session.status !== "open") throw new ImportError(`session is ${session.status}`, 409);

  const rows = session.rows;
  const unresolved = rows.filter((r) => r.decision === "review");
  if (unresolved.length && !opts.force) {
    throw new ImportError(`${unresolved.length} row(s) still need a decision`, 409, {
      unresolved: unresolved.map((r) => ({ id: r.id, title: r.title, holdReason: r.holdReason })),
    });
  }
  const invalid = unresolved.filter((r) => r.holdReason === "invalid");
  if (invalid.length) {
    throw new ImportError(`${invalid.length} row(s) are invalid and cannot be imported`, 409, {
      invalid: invalid.map((r) => ({ id: r.id, title: r.title, problems: JSON.parse(r.problems) })),
    });
  }

  const importing = rows.filter((r) => r.decision !== "dropped");
  const ids = importing.map((r) => r.chosenIgdbId).filter((x): x is number => x != null);
  const synced = await catalog.sync(ids);

  // Fold in-session merges into their target rows.
  const extraQuantity = new Map<string, number>();
  for (const r of importing) {
    if (r.decision === "merge" && r.dedupeKind === "in-session" && r.dedupeTargetId) {
      extraQuantity.set(r.dedupeTargetId, (extraQuantity.get(r.dedupeTargetId) ?? 0) + r.quantity);
    }
  }

  const result = await prisma.$transaction(async (tx) => {
    const batch = await tx.importBatch.create({ data: { sessionId, label: session.label } });
    let created = 0;
    let merged = 0;
    let unlinked = 0;
    for (const r of importing) {
      if (r.decision === "merge") {
        if (r.dedupeKind === "existing" && r.dedupeTargetId) {
          await tx.ownedGame.update({ where: { id: r.dedupeTargetId }, data: { quantity: { increment: r.quantity } } });
          await tx.importEffect.create({ data: { batchId: batch.id, kind: "quantity", ownedGameId: r.dedupeTargetId, delta: r.quantity } });
          merged++;
        }
        continue; // in-session merges were folded above
      }
      const quantity = r.quantity + (extraQuantity.get(r.id) ?? 0);
      const linked = r.decision === "review" ? null : r.chosenIgdbId;
      const catalogExists = linked != null ? await tx.catalogGame.findUnique({ where: { igdbId: linked }, select: { igdbId: true } }) : null;
      const owned = await tx.ownedGame.create({
        data: {
          title: r.title,
          normalizedTitle: r.normalizedTitle,
          platform: r.platform,
          quantity,
          completeness: (JSON.parse(r.input) as ImportRowInput).completeness ?? null,
          condition: (JSON.parse(r.input) as ImportRowInput).condition ?? null,
          notes: (JSON.parse(r.input) as ImportRowInput).notes ?? null,
          catalogGameId: catalogExists ? linked : null,
          matchConfidence: catalogExists ? r.chosenConfidence : null,
          matchSource: catalogExists ? (r.decidedBy === "api" ? "auto" : r.decidedBy === "agent" ? "agent" : "manual") : null,
          importBatchId: batch.id,
        },
      });
      await tx.importEffect.create({ data: { batchId: batch.id, kind: "created", ownedGameId: owned.id } });
      created++;
      if (!catalogExists) unlinked++;
      if (r.decision === "review") await tx.importRow.update({ where: { id: r.id }, data: { decision: "accepted", decidedBy: "user", chosenIgdbId: null } });
    }
    await tx.importSession.update({ where: { id: sessionId }, data: { status: "committed" } });
    return { batchId: batch.id, created, merged, unlinked };
  });

  return { ...result, dropped: rows.length - importing.length, catalog: { full: synced.full, stubs: synced.stubs } };
}

export type RollbackResult = { batchId: string; removed: number; decremented: number };

/** Reverse every effect of a batch, newest first, and nothing else. */
export async function rollbackBatch(batchId: string): Promise<RollbackResult> {
  const batch = await prisma.importBatch.findUnique({ where: { id: batchId }, include: { effects: true } });
  if (!batch) throw new ImportError("batch not found", 404);
  if (batch.status !== "committed") throw new ImportError(`batch is ${batch.status}`, 409);

  return prisma.$transaction(async (tx) => {
    let removed = 0;
    let decremented = 0;
    for (const effect of [...batch.effects].reverse()) {
      if (effect.kind === "created") {
        await tx.ownedGame.delete({ where: { id: effect.ownedGameId } });
        removed++;
      } else if (effect.kind === "quantity" && effect.delta) {
        await tx.ownedGame.update({ where: { id: effect.ownedGameId }, data: { quantity: { decrement: effect.delta } } });
        decremented++;
      }
    }
    await tx.importBatch.update({ where: { id: batchId }, data: { status: "rolled_back", rolledBackAt: new Date() } });
    await tx.importSession.update({ where: { id: batch.sessionId }, data: { status: "open" } });
    return { batchId, removed, decremented };
  });
}

export async function listBatches() {
  return prisma.importBatch.findMany({ orderBy: { committedAt: "desc" }, include: { _count: { select: { effects: true } } } });
}
