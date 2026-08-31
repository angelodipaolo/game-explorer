import type { JournalEntry } from "@prisma/client";
import { z } from "zod";
import { whenSchema } from "@/lib/dates";
import { prisma } from "@/lib/db";
import { EnrichmentError } from "@/lib/enrichment/service";
import { MAX_IMAGE_BYTES, sniffImage } from "@/lib/media/image-store";
import { journalImages } from "./image";

/**
 * The game journal: dated notes and photos about one owned copy, optionally
 * tied to the run they were written during.
 *
 * One table for both kinds on purpose — the journal is one chronological feed,
 * and two tables would be merged again in every query and every view.
 *
 * Like GameCode and GameMap there is no `source` and no precedence. Unlike
 * them there is **no agent write path at all**: a memory is not a public fact
 * about a game, and only the owner can produce one.
 *
 * Photo upload is two steps, the same as maps: POST the row, then PUT the
 * bytes. A JSON body and a 4 MB phone photo do not belong in one request.
 */

export const ENTRY_KINDS = ["note", "photo"] as const;
export type EntryKind = (typeof ENTRY_KINDS)[number];

/** Enough for a decade of playing one game; more than that is a feed nobody scrolls. */
export const MAX_ENTRIES_PER_GAME = 500;
export { MAX_IMAGE_BYTES };

const blank = (v: string | null | undefined) => (v === undefined ? undefined : v || null);
/** A bare "2026-08-30" means local midnight, not UTC — see src/lib/dates.ts. */
const when = whenSchema;

const fields = {
  title: z.string().trim().max(120).nullish(),
  body: z.string().trim().max(10000).nullish(),
  occurredAt: when.optional(),
  sessionId: z.string().min(1).nullish(),
};

export const entryInputSchema = z.object({ kind: z.enum(ENTRY_KINDS), ...fields });
export type EntryInput = z.infer<typeof entryInputSchema>;

export const entryPatchSchema = z.object({ kind: z.enum(ENTRY_KINDS).optional(), ...fields });
export type EntryPatch = z.infer<typeof entryPatchSchema>;

async function requireOwned(ownedGameId: string) {
  const owned = await prisma.ownedGame.findUnique({ where: { id: ownedGameId }, select: { id: true } });
  if (!owned) throw new EnrichmentError("owned game not found", 404);
}

async function requireEntry(entryId: string) {
  const e = await prisma.journalEntry.findUnique({ where: { id: entryId } });
  if (!e) throw new EnrichmentError("journal entry not found", 404);
  return e;
}

/**
 * A run belongs to exactly one copy, so an entry can only be filed under a run
 * of the copy it is about — otherwise the 2026 SNES playthrough would collect
 * notes about the DS cartridge.
 */
async function assertSessionBelongs(ownedGameId: string, sessionId: string) {
  const s = await prisma.playSession.findUnique({ where: { id: sessionId }, select: { ownedGameId: true } });
  if (!s) throw new EnrichmentError("play session not found", 404);
  if (s.ownedGameId !== ownedGameId) throw new EnrichmentError("that run belongs to a different copy", 400);
}

/**
 * Add a note or an (as yet empty) photo row. A `note` needs writing in it; a
 * `photo` does not, because the image is the content and the caption is
 * optional.
 */
export async function addEntry(ownedGameId: string, input: EntryInput): Promise<JournalEntry> {
  await requireOwned(ownedGameId);
  if (input.kind === "note" && !input.body?.trim()) throw new EnrichmentError("a note needs something written in it", 400);
  if (input.sessionId) await assertSessionBelongs(ownedGameId, input.sessionId);
  if ((await prisma.journalEntry.count({ where: { ownedGameId } })) >= MAX_ENTRIES_PER_GAME) {
    throw new EnrichmentError(`this game already has ${MAX_ENTRIES_PER_GAME} journal entries`, 409);
  }
  return prisma.journalEntry.create({
    data: {
      ownedGameId,
      kind: input.kind,
      title: blank(input.title) ?? null,
      body: blank(input.body) ?? null,
      occurredAt: input.occurredAt ?? new Date(),
      sessionId: input.sessionId ?? null,
    },
  });
}

export async function updateEntry(entryId: string, patch: EntryPatch): Promise<JournalEntry> {
  const e = await requireEntry(entryId);
  const kind = patch.kind ?? e.kind;
  const body = patch.body === undefined ? e.body : blank(patch.body);
  if (kind === "note" && !body?.trim()) throw new EnrichmentError("a note needs something written in it", 400);
  if (patch.sessionId) await assertSessionBelongs(e.ownedGameId, patch.sessionId);

  // Turning a photo into a note drops the image: leaving the file on disk
  // would strand bytes nothing references, and leaving width/height set would
  // have the feed lay out a thumbnail for a picture that is no longer there.
  const droppingPhoto = e.kind === "photo" && kind === "note";
  const updated = await prisma.journalEntry.update({
    where: { id: entryId },
    data: {
      kind: patch.kind,
      title: blank(patch.title),
      body: patch.body === undefined ? undefined : body,
      occurredAt: patch.occurredAt,
      sessionId: patch.sessionId === undefined ? undefined : patch.sessionId ?? null,
      ...(droppingPhoto ? { width: 0, height: 0 } : {}),
    },
  });
  if (droppingPhoto) await journalImages.delete(entryId);
  return updated;
}

/** Remove the entry and its photo file. */
export async function deleteEntry(entryId: string): Promise<void> {
  await requireEntry(entryId);
  await prisma.journalEntry.delete({ where: { id: entryId } });
  await journalImages.delete(entryId);
}

/** One copy's journal, newest first. */
export async function entriesFor(ownedGameId: string): Promise<JournalEntry[]> {
  return prisma.journalEntry.findMany({ where: { ownedGameId }, orderBy: [{ occurredAt: "desc" }, { createdAt: "desc" }] });
}

/** Store the photo bytes and record their pixel size on the entry. */
export async function setEntryImage(entryId: string, buf: Buffer): Promise<JournalEntry> {
  const e = await requireEntry(entryId);
  if (e.kind !== "photo") throw new EnrichmentError("only a photo entry can hold an image", 400);
  if (buf.length > MAX_IMAGE_BYTES) throw new EnrichmentError(`image is larger than ${MAX_IMAGE_BYTES / 1024 / 1024} MB`, 413);
  const info = sniffImage(buf);
  if (!info) throw new EnrichmentError("image must be a PNG or JPEG", 415);
  await journalImages.write(entryId, buf, info);
  return prisma.journalEntry.update({ where: { id: entryId }, data: { width: info.width, height: info.height } });
}

/** The stored photo, or null when none has been uploaded yet. */
export async function readEntryImage(entryId: string) {
  return journalImages.read(entryId);
}

export type { JournalEntry };
