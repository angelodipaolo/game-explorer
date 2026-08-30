import type { GameCode } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { EnrichmentError } from "@/lib/enrichment/service";
import { platformLabel } from "@/lib/platforms";
import { CODE_KINDS, MAX_CODES_PER_GAME, codeKeyOf, isCodeKind, kindRank, type CodeKind } from "./kinds";

/**
 * Passwords, cheats and cheat-device codes for one owned copy.
 *
 * There is deliberately no notion of who wrote a row. A code typed in on the
 * game page and a code written by a research skill are the same record through
 * the same functions, and neither outranks the other — codes are a list, not a
 * contested value, so the manual > agent > igdb precedence that governs facts
 * and tags does not apply here. See the ticket plan before "restoring" it.
 */

/**
 * Optional text is three-valued: absent leaves the column alone, "" or null
 * clears it, anything else sets it. `blank` below collapses "" to null while
 * keeping absent distinct, which is what makes PATCH a real partial update.
 */
const text = (max: number) => z.string().trim().max(max).nullish();
const urlField = z.union([z.literal(""), z.string().trim().url().max(500)]).nullish();

const blank = (v: string | null | undefined) => (v === undefined ? undefined : v || null);

const fields = {
  effect: z.string().trim().min(1).max(200),
  code: text(200),
  howTo: text(500),
  sourceUrl: urlField,
  note: text(500),
  verified: z.boolean().optional(),
  position: z.number().int().min(0).max(999).optional(),
};

/** Adding one code to one game: kind and effect required, the rest optional. */
export const codeInputSchema = z.object({ kind: z.enum(CODE_KINDS), ...fields });
export type CodeInput = z.infer<typeof codeInputSchema>;

/** Editing one: every field optional, including the kind. */
export const codePatchSchema = z.object({ kind: z.enum(CODE_KINDS).optional(), ...fields, effect: fields.effect.optional() });
export type CodePatch = z.infer<typeof codePatchSchema>;

/**
 * The batch body. `kind` is a plain string here on purpose: a batch of 500 with
 * one unknown kind should write the other 499 and report the one, not 400 the
 * lot. Structural problems (a missing effect) still fail the request.
 */
export const writeCodesSchema = z.object({
  codes: z
    .array(z.object({ ownedGameId: z.string().min(1), kind: z.string().min(1), ...fields }))
    .min(1)
    .max(500),
});
export type BatchCodeInput = z.infer<typeof writeCodesSchema>["codes"][number];

export type CodeWriteResult = {
  written: { ownedGameId: string; kind: string; effect: string; id: string }[];
  skipped: { ownedGameId: string; kind: string; effect: string; reason: string }[];
};

/** One copy's codes, grouped kind by kind in CODE_KINDS order. */
export async function codesFor(ownedGameId: string) {
  const rows = await prisma.gameCode.findMany({ where: { ownedGameId } });
  return rows.sort((a, b) => kindRank(a.kind) - kindRank(b.kind) || a.position - b.position || a.createdAt.getTime() - b.createdAt.getTime());
}

async function requireOwned(ownedGameId: string) {
  const owned = await prisma.ownedGame.findUnique({ where: { id: ownedGameId }, select: { id: true } });
  if (!owned) throw new EnrichmentError("owned game not found", 404);
}

/** Prisma leaves a column alone when its value is `undefined` — that is the seam blank() feeds. */
function writeData(input: { effect: string; code?: string | null; howTo?: string | null; sourceUrl?: string | null; note?: string | null; verified?: boolean; position?: number }) {
  return { effect: input.effect, code: blank(input.code), howTo: blank(input.howTo), sourceUrl: blank(input.sourceUrl), note: blank(input.note), verified: input.verified, position: input.position };
}

/**
 * Add one code, or update the one already there. The unique key is
 * (game, kind, normalised code), so writing the same Game Genie code twice
 * refreshes it in place instead of stacking a duplicate.
 */
export async function addCode(ownedGameId: string, input: CodeInput) {
  await requireOwned(ownedGameId);
  const codeKey = codeKeyOf(input.code, input.effect);
  const where = { ownedGameId_kind_codeKey: { ownedGameId, kind: input.kind, codeKey } };
  const existing = await prisma.gameCode.findUnique({ where });
  if (!existing && (await prisma.gameCode.count({ where: { ownedGameId } })) >= MAX_CODES_PER_GAME) {
    throw new EnrichmentError(`this game already has ${MAX_CODES_PER_GAME} codes`, 409);
  }
  const d = writeData(input);
  return prisma.gameCode.upsert({
    where,
    create: { ownedGameId, kind: input.kind, codeKey, ...d, code: d.code ?? null, howTo: d.howTo ?? null, sourceUrl: d.sourceUrl ?? null, note: d.note ?? null, verified: d.verified ?? false, position: d.position ?? 0 },
    update: d,
  });
}

/**
 * Write many codes across many games. Partial success by design: a bad entry is
 * reported in `skipped` with a reason and the rest still land.
 */
export async function addCodes(entries: BatchCodeInput[]): Promise<CodeWriteResult> {
  const result: CodeWriteResult = { written: [], skipped: [] };
  /** Running count per game so a batch cannot walk past the cap. */
  const counts = new Map<string, number>();
  for (const e of entries) {
    const label = { ownedGameId: e.ownedGameId, kind: e.kind, effect: e.effect };
    if (!isCodeKind(e.kind)) {
      result.skipped.push({ ...label, reason: `unknown kind — expected one of ${CODE_KINDS.join(", ")}` });
      continue;
    }
    const owned = await prisma.ownedGame.findUnique({ where: { id: e.ownedGameId }, select: { id: true } });
    if (!owned) {
      result.skipped.push({ ...label, reason: "owned game not found" });
      continue;
    }
    const codeKey = codeKeyOf(e.code, e.effect);
    const where = { ownedGameId_kind_codeKey: { ownedGameId: e.ownedGameId, kind: e.kind, codeKey } };
    const existing = await prisma.gameCode.findUnique({ where });
    if (!existing) {
      let n = counts.get(e.ownedGameId);
      if (n === undefined) {
        n = await prisma.gameCode.count({ where: { ownedGameId: e.ownedGameId } });
        counts.set(e.ownedGameId, n);
      }
      if (n >= MAX_CODES_PER_GAME) {
        result.skipped.push({ ...label, reason: `already at the ${MAX_CODES_PER_GAME}-code limit` });
        continue;
      }
      counts.set(e.ownedGameId, n + 1);
    }
    const d = writeData(e);
    const row = await prisma.gameCode.upsert({
      where,
      create: { ownedGameId: e.ownedGameId, kind: e.kind, codeKey, ...d, code: d.code ?? null, howTo: d.howTo ?? null, sourceUrl: d.sourceUrl ?? null, note: d.note ?? null, verified: d.verified ?? false, position: d.position ?? 0 },
      update: d,
    });
    result.written.push({ ...label, id: row.id });
  }
  return result;
}

/** Edit a code, or tick it verified. A rename onto a sibling's key is a 409. */
export async function updateCode(ownedGameId: string, codeId: string, patch: CodePatch) {
  const row = await prisma.gameCode.findFirst({ where: { id: codeId, ownedGameId } });
  if (!row) throw new EnrichmentError("code not found", 404);
  const kind = patch.kind ?? row.kind;
  const effect = patch.effect ?? row.effect;
  const code = patch.code === undefined ? row.code : (blank(patch.code) ?? null);
  const codeKey = codeKeyOf(code, effect);
  if (codeKey !== row.codeKey || kind !== row.kind) {
    const clash = await prisma.gameCode.findUnique({ where: { ownedGameId_kind_codeKey: { ownedGameId, kind, codeKey } } });
    if (clash && clash.id !== codeId) throw new EnrichmentError("this game already has that code", 409);
  }
  return prisma.gameCode.update({ where: { id: codeId }, data: { kind, effect, code, codeKey, howTo: blank(patch.howTo), sourceUrl: blank(patch.sourceUrl), note: blank(patch.note), verified: patch.verified, position: patch.position } });
}

export async function removeCode(ownedGameId: string, codeId: string) {
  const { count } = await prisma.gameCode.deleteMany({ where: { id: codeId, ownedGameId } });
  if (!count) throw new EnrichmentError("code not found", 404);
}

export type CodeGap = {
  ownedGameId: string;
  title: string;
  name: string;
  platform: string;
  year: number | null;
  igdbId: number | null;
  /** What it already has, per kind — so a research pass does not redo it. */
  have: Partial<Record<CodeKind, number>>;
};

/**
 * Owned copies with no codes at all, or — when `kinds` is given — none of those
 * kinds. Codes are per copy, so the `ownedGameId` here is what a batch write
 * must use: the NES and SNES copies of one game are two separate gaps.
 */
export async function listCodeGaps(kinds?: CodeKind[], limit = 50, offset = 0): Promise<{ total: number; gaps: CodeGap[] }> {
  const owned = await prisma.ownedGame.findMany({ include: { catalogGame: { select: { name: true, igdbId: true, firstReleaseDate: true } }, codes: { select: { kind: true } } }, orderBy: { title: "asc" } });
  const gaps: CodeGap[] = [];
  for (const g of owned) {
    const have: CodeGap["have"] = {};
    for (const c of g.codes) if (isCodeKind(c.kind)) have[c.kind] = (have[c.kind] ?? 0) + 1;
    const relevant = kinds?.length ? kinds.reduce((n, k) => n + (have[k] ?? 0), 0) : g.codes.length;
    if (relevant > 0) continue;
    gaps.push({
      ownedGameId: g.id,
      title: g.title,
      name: g.catalogGame?.name ?? g.title,
      platform: platformLabel(g.platform),
      year: g.catalogGame?.firstReleaseDate?.getUTCFullYear() ?? null,
      igdbId: g.catalogGame?.igdbId ?? null,
      have,
    });
  }
  return { total: gaps.length, gaps: gaps.slice(offset, offset + limit) };
}

export type { GameCode };
export { CODE_KINDS, MAX_CODES_PER_GAME, codeKeyOf, isCodeKind, type CodeKind } from "./kinds";
