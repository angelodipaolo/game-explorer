import { z } from "zod";
import { prisma } from "@/lib/db";
import { FACT_FIELDS, catalogPlayerData, resolvePlayerProfile, type FactField, type PlayerProfile } from "@/lib/facts";
import { platformLabel } from "@/lib/platforms";

/**
 * Batch enrichment: an agent lists what is missing, researches it, and writes
 * facts back marked as agent-sourced with a citation. Manual facts are never
 * overwritten by an agent; agent facts are replaced by newer agent facts.
 */

export class EnrichmentError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "EnrichmentError";
  }
}

// `coop` is the umbrella; `localCoop` and `onlineCoop` are the two kinds, both
// of which IGDB answers for part of the shelf and research fills in the rest.
const BOOL_FIELDS: FactField[] = ["singlePlayer", "multiplayer", "coop", "localCoop", "onlineCoop", "splitscreen", "simultaneousPlay"];
const NUM_FIELDS: FactField[] = ["maxPlayers", "coopMaxPlayers", "playtimeMinutes"];

export const factInputSchema = z
  .object({
    ownedGameId: z.string().min(1),
    field: z.enum(FACT_FIELDS),
    value: z.union([z.boolean(), z.number().int().min(0).max(100000)]),
    /** Required for agent facts: where it was found. */
    sourceUrl: z.string().url().optional(),
    note: z.string().max(500).optional(),
  })
  .refine((f) => (BOOL_FIELDS.includes(f.field) ? typeof f.value === "boolean" : typeof f.value === "number"), { message: "value type does not match field" });
export type FactInput = z.infer<typeof factInputSchema>;

export const writeFactsSchema = z.object({ facts: z.array(factInputSchema).min(1).max(500) });

export type Gap = {
  ownedGameId: string;
  title: string;
  name: string;
  platform: string;
  year: number | null;
  igdbId: number | null;
  missing: FactField[];
  known: Partial<Record<FactField, { value: boolean | number; source: string }>>;
};

/** Owned games missing any of `fields`, with what is already known so the agent does not redo it. */
export async function listGaps(fields: FactField[] = ["maxPlayers", "simultaneousPlay", "coop"], limit = 50, offset = 0): Promise<{ total: number; gaps: Gap[] }> {
  const owned = await prisma.ownedGame.findMany({ include: { catalogGame: true, facts: true }, orderBy: { title: "asc" } });
  const gaps: Gap[] = [];
  for (const g of owned) {
    const c = g.catalogGame;
    const profile = resolvePlayerProfile(catalogPlayerData(c), g.facts);
    const missing = fields.filter((f) => profile[f].value == null);
    if (!missing.length) continue;
    const known: Gap["known"] = {};
    for (const f of FACT_FIELDS) {
      const fact = profile[f] as PlayerProfile[FactField];
      if (fact.value != null && fact.source) known[f] = { value: fact.value, source: fact.source };
    }
    gaps.push({ ownedGameId: g.id, title: g.title, name: c?.name ?? g.title, platform: platformLabel(g.platform), year: c?.firstReleaseDate?.getUTCFullYear() ?? null, igdbId: c?.igdbId ?? null, missing, known });
  }
  return { total: gaps.length, gaps: gaps.slice(offset, offset + limit) };
}

export async function startRun(label?: string) {
  return prisma.enrichmentRun.create({ data: { label: label ?? null } });
}

export type WriteResult = {
  written: { ownedGameId: string; field: FactField; value: boolean | number }[];
  skipped: { ownedGameId: string; field: FactField; reason: string }[];
};

/**
 * Write agent facts. Rules:
 *   - a `manual` fact for the same field is never touched (reported as skipped)
 *   - an agent fact must cite a sourceUrl
 *   - unknown owned game ids are skipped, not fatal
 */
export async function writeAgentFacts(runId: string, facts: FactInput[]): Promise<WriteResult> {
  const run = await prisma.enrichmentRun.findUnique({ where: { id: runId } });
  if (!run) throw new EnrichmentError("run not found", 404);
  if (run.finishedAt) throw new EnrichmentError("run is finished", 409);
  const result: WriteResult = { written: [], skipped: [] };
  for (const f of facts) {
    if (!f.sourceUrl) {
      result.skipped.push({ ownedGameId: f.ownedGameId, field: f.field, reason: "no sourceUrl — agent facts must cite a source" });
      continue;
    }
    const owned = await prisma.ownedGame.findUnique({ where: { id: f.ownedGameId }, select: { id: true } });
    if (!owned) {
      result.skipped.push({ ownedGameId: f.ownedGameId, field: f.field, reason: "owned game not found" });
      continue;
    }
    const existing = await prisma.gameFact.findUnique({ where: { ownedGameId_field: { ownedGameId: f.ownedGameId, field: f.field } } });
    if (existing?.source === "manual") {
      result.skipped.push({ ownedGameId: f.ownedGameId, field: f.field, reason: "set by hand; agents never overwrite manual facts" });
      continue;
    }
    await prisma.gameFact.upsert({
      where: { ownedGameId_field: { ownedGameId: f.ownedGameId, field: f.field } },
      create: { ownedGameId: f.ownedGameId, field: f.field, value: JSON.stringify(f.value), source: "agent", sourceUrl: f.sourceUrl, note: f.note ?? null, runId },
      update: { value: JSON.stringify(f.value), source: "agent", sourceUrl: f.sourceUrl, note: f.note ?? null, runId },
    });
    result.written.push({ ownedGameId: f.ownedGameId, field: f.field, value: f.value });
  }
  return result;
}

/** A person's own fact. Beats everything; never overwritten by sync or agents. */
export async function writeManualFact(ownedGameId: string, field: FactField, value: boolean | number | null, note?: string) {
  const owned = await prisma.ownedGame.findUnique({ where: { id: ownedGameId }, select: { id: true } });
  if (!owned) throw new EnrichmentError("owned game not found", 404);
  if (value == null) {
    await prisma.gameFact.deleteMany({ where: { ownedGameId, field } });
    return null;
  }
  const isBool = BOOL_FIELDS.includes(field);
  if (isBool ? typeof value !== "boolean" : typeof value !== "number") throw new EnrichmentError("value type does not match field", 400);
  return prisma.gameFact.upsert({
    where: { ownedGameId_field: { ownedGameId, field } },
    create: { ownedGameId, field, value: JSON.stringify(value), source: "manual", note: note ?? null },
    update: { value: JSON.stringify(value), source: "manual", sourceUrl: null, note: note ?? null, runId: null },
  });
}

export type RunReport = { id: string; label: string | null; startedAt: Date; finishedAt: Date | null; factsWritten: number; gamesTouched: number; byField: Record<string, number>; summary: unknown };

export async function runReport(runId: string): Promise<RunReport> {
  const run = await prisma.enrichmentRun.findUnique({ where: { id: runId } });
  if (!run) throw new EnrichmentError("run not found", 404);
  const facts = await prisma.gameFact.findMany({ where: { runId } });
  const byField: Record<string, number> = {};
  for (const f of facts) byField[f.field] = (byField[f.field] ?? 0) + 1;
  return { id: run.id, label: run.label, startedAt: run.startedAt, finishedAt: run.finishedAt, factsWritten: facts.length, gamesTouched: new Set(facts.map((f) => f.ownedGameId)).size, byField, summary: run.summary ? JSON.parse(run.summary) : null };
}

export async function finishRun(runId: string, summary?: unknown): Promise<RunReport> {
  const report = await runReport(runId);
  await prisma.enrichmentRun.update({ where: { id: runId }, data: { finishedAt: new Date(), summary: JSON.stringify(summary ?? { factsWritten: report.factsWritten, gamesTouched: report.gamesTouched, byField: report.byField }) } });
  return runReport(runId);
}

export { NUM_FIELDS, BOOL_FIELDS };
