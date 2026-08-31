import type { GameManual, ManualPage } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { EnrichmentError } from "@/lib/enrichment/service";
import { MAX_IMAGE_BYTES, sniffImage } from "@/lib/media/image-store";
import { manualImages } from "./image";

/**
 * Scanned manuals for one owned copy: an ordered set of page images.
 *
 * Mechanically this is GameMap with pages instead of markers, and it reuses
 * the same on-disk store (src/lib/media/image-store.ts) rather than inventing
 * a third one. Same stance as codes and maps: no `source`, no precedence.
 *
 * The write path is two steps — POST the page row, then PUT the bytes —
 * because a JSON body and a multi-megabyte scan do not belong in one request.
 * A page with no bytes yet is a real state the viewer renders ("not scanned
 * yet"), not an error.
 *
 * `position` is dense 0..n-1 and renumbered on every insert, reorder and
 * delete, so "page 4 of 12" is always literally true.
 */

/** A thick NES manual is ~40 pages; 200 leaves room for a strategy insert. */
export const MAX_PAGES_PER_MANUAL = 200;
/** A shelf copy has a manual, maybe a poster map and an insert. Not a library. */
export const MAX_MANUALS_PER_GAME = 10;
export { MAX_IMAGE_BYTES };

const text = (max: number) => z.string().trim().max(max).nullish();
const urlField = z.union([z.literal(""), z.string().trim().url().max(500)]).nullish();
const blank = (v: string | null | undefined) => (v === undefined ? undefined : v || null);

export const manualInputSchema = z.object({
  /** Defaults to "Manual" — the overwhelmingly common case needs no typing. */
  title: z.string().trim().min(1).max(80).optional(),
  sourceUrl: urlField,
  note: text(500),
  position: z.number().int().min(0).max(999).optional(),
});
export type ManualInput = z.infer<typeof manualInputSchema>;

export const manualPatchSchema = manualInputSchema;
export type ManualPatch = z.infer<typeof manualPatchSchema>;

export const pageInputSchema = z.object({
  label: text(80),
  /**
   * Where to insert. Absent appends; anything past the end clamps to the end.
   * Pages arrive in order far more often than not, so appending is the default.
   */
  position: z.number().int().min(0).max(MAX_PAGES_PER_MANUAL).optional(),
});
export type PageInput = z.infer<typeof pageInputSchema>;

export const pagePatchSchema = z.object({ label: text(80) });
export type PagePatch = z.infer<typeof pagePatchSchema>;

/** The reorder body: every page id of this manual, exactly once, in the new order. */
export const reorderPagesSchema = z.object({ orderedIds: z.array(z.string().min(1)).max(MAX_PAGES_PER_MANUAL) });

export type ManualWithPages = GameManual & { pages: ManualPage[] };

/** A Prisma transaction client — what every check that guards a write must run on. */
type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

async function requireOwned(ownedGameId: string) {
  const owned = await prisma.ownedGame.findUnique({ where: { id: ownedGameId }, select: { id: true } });
  if (!owned) throw new EnrichmentError("owned game not found", 404);
}

async function requireManual(manualId: string): Promise<GameManual> {
  const m = await prisma.gameManual.findUnique({ where: { id: manualId } });
  if (!m) throw new EnrichmentError("manual not found", 404);
  return m;
}

async function requirePage(pageId: string): Promise<ManualPage> {
  const p = await prisma.manualPage.findUnique({ where: { id: pageId } });
  if (!p) throw new EnrichmentError("manual page not found", 404);
  return p;
}

const byOrder = <T extends { position: number; createdAt: Date }>(a: T, b: T) => a.position - b.position || a.createdAt.getTime() - b.createdAt.getTime();

/** One copy's manuals with their pages, in reading order. */
export async function manualsFor(ownedGameId: string): Promise<ManualWithPages[]> {
  const rows = await prisma.gameManual.findMany({ where: { ownedGameId }, include: { pages: true } });
  return rows.sort(byOrder).map((m) => ({ ...m, pages: m.pages.sort(byOrder) }));
}

export async function manualById(manualId: string): Promise<ManualWithPages | null> {
  const m = await prisma.gameManual.findUnique({ where: { id: manualId }, include: { pages: true } });
  return m ? { ...m, pages: m.pages.sort(byOrder) } : null;
}

/**
 * A new manual every time, deliberately: unlike a map there is no slug to
 * upsert on, and two scans of the same booklet are two scans. The cap is what
 * stops a retried script filling the page with them.
 */
export async function createManual(ownedGameId: string, input: ManualInput = {}): Promise<GameManual> {
  await requireOwned(ownedGameId);
  const existing = await prisma.gameManual.count({ where: { ownedGameId } });
  if (existing >= MAX_MANUALS_PER_GAME) throw new EnrichmentError(`this game already has ${MAX_MANUALS_PER_GAME} manuals`, 409);
  return prisma.gameManual.create({
    data: {
      ownedGameId,
      title: input.title ?? "Manual",
      sourceUrl: blank(input.sourceUrl) ?? null,
      note: blank(input.note) ?? null,
      position: input.position ?? existing,
    },
  });
}

export async function updateManual(manualId: string, patch: ManualPatch): Promise<GameManual> {
  await requireManual(manualId);
  return prisma.gameManual.update({
    where: { id: manualId },
    data: { title: patch.title, sourceUrl: blank(patch.sourceUrl), note: blank(patch.note), position: patch.position },
  });
}

/**
 * Remove the manual, its page rows (by cascade) and every page file. The ids
 * are read before the delete, because after it there is nothing left to say
 * which files were ours — and a file left behind is bytes nothing references.
 */
export async function deleteManual(manualId: string): Promise<void> {
  await requireManual(manualId);
  const pages = await prisma.manualPage.findMany({ where: { manualId }, select: { id: true } });
  await prisma.gameManual.delete({ where: { id: manualId } });
  await Promise.all(pages.map((p) => manualImages.delete(p.id)));
}

/**
 * Renumber a manual's pages 0..n-1 in the given order.
 *
 * Always takes a transaction client, never the bare `prisma`: the read that
 * decided this order and the writes that apply it have to be one atomic step,
 * or two concurrent inserts interleave and scatter a scanned manual.
 *
 * Two passes through a negative range: `position` has no unique constraint
 * today, but writing 0,1,2… straight over 0,1,2… would still momentarily
 * collide if one is ever added, and this costs nothing.
 */
async function renumber(tx: Tx, manualId: string, ids: string[]) {
  for (const [i, id] of ids.entries()) await tx.manualPage.update({ where: { id }, data: { position: -1 - i } });
  for (const [i, id] of ids.entries()) await tx.manualPage.update({ where: { id }, data: { position: i } });
  return tx.manualPage.findMany({ where: { manualId }, orderBy: { position: "asc" } });
}

/**
 * Add an empty page row at `position` (append by default), then PUT its bytes
 * to /api/manual-pages/:id/image. Everything after it shifts down, so
 * inserting a missed page 3 does not require re-uploading the rest.
 */
export async function addPage(manualId: string, input: PageInput = {}): Promise<ManualPage> {
  await requireManual(manualId);
  // The count that picks the insert point, the cap check and the create are one
  // transaction: two pages POSTed at once would otherwise both read the same
  // length and land on the same position.
  return prisma.$transaction(async (tx) => {
    const pages = await tx.manualPage.findMany({ where: { manualId }, orderBy: { position: "asc" }, select: { id: true } });
    if (pages.length >= MAX_PAGES_PER_MANUAL) throw new EnrichmentError(`this manual already has ${MAX_PAGES_PER_MANUAL} pages`, 409);
    const at = Math.min(input.position ?? pages.length, pages.length);
    const page = await tx.manualPage.create({ data: { manualId, position: pages.length, label: blank(input.label) ?? null } });
    if (at === pages.length) return page;
    const ids = pages.map((p) => p.id);
    ids.splice(at, 0, page.id);
    await renumber(tx, manualId, ids);
    return tx.manualPage.findUniqueOrThrow({ where: { id: page.id } });
  });
}

export async function updatePage(pageId: string, patch: PagePatch): Promise<ManualPage> {
  await requirePage(pageId);
  return prisma.manualPage.update({ where: { id: pageId }, data: { label: blank(patch.label) } });
}

/** Store the scan bytes and record their pixel size on the page. */
export async function setPageImage(pageId: string, buf: Buffer): Promise<ManualPage> {
  await requirePage(pageId);
  if (buf.length > MAX_IMAGE_BYTES) throw new EnrichmentError(`image is larger than ${MAX_IMAGE_BYTES / 1024 / 1024} MB`, 413);
  const info = sniffImage(buf);
  if (!info) throw new EnrichmentError("image must be a PNG or JPEG", 415);
  await manualImages.write(pageId, buf, info);
  return prisma.manualPage.update({ where: { id: pageId }, data: { width: info.width, height: info.height } });
}

/** The stored scan, or null when none has been uploaded yet. */
export async function readPageImage(pageId: string) {
  return manualImages.read(pageId);
}

/** Remove a page and its file, then close the gap so numbering stays dense. */
export async function deletePage(pageId: string): Promise<ManualPage[]> {
  const page = await requirePage(pageId);
  const rest = await prisma.$transaction(async (tx) => {
    await tx.manualPage.delete({ where: { id: pageId } });
    const left = await tx.manualPage.findMany({ where: { manualId: page.manualId }, orderBy: { position: "asc" }, select: { id: true } });
    return renumber(
      tx,
      page.manualId,
      left.map((p) => p.id),
    );
  });
  // The file goes only once the row is certainly gone: a rolled-back delete
  // that had already unlinked the scan would leave a page with no pixels.
  await manualImages.delete(pageId);
  return rest;
}

/**
 * Reorder by permutation, not by "move page 4 to 7": the body must list every
 * page of this manual exactly once. A partial list is a bug in the caller —
 * accepting it would silently drop the pages it forgot to the end, and
 * scattering a scanned manual is not something to recover from by hand.
 * Modelled on reorderQueue in src/lib/play/service.ts.
 */
export async function reorderPages(manualId: string, orderedIds: string[]): Promise<ManualPage[]> {
  await requireManual(manualId);
  // The permutation check and the renumber it guards run on one transaction
  // client: a check made before the write it guards is not a check at all — a
  // page added between the two would be left holding a duplicate position.
  return prisma.$transaction(async (tx) => {
    const current = await tx.manualPage.findMany({ where: { manualId }, select: { id: true } });
    const have = new Set(current.map((p) => p.id));
    const want = new Set(orderedIds);
    if (want.size !== orderedIds.length) throw new EnrichmentError("the same page is listed twice", 400);
    if (have.size !== want.size || [...have].some((id) => !want.has(id))) {
      throw new EnrichmentError("the order must list exactly the pages in this manual", 400, { pages: [...have] });
    }
    return renumber(tx, manualId, orderedIds);
  });
}

export type { GameManual, ManualPage };
