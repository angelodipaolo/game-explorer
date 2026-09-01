import type { MusicTrack } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { EnrichmentError } from "@/lib/enrichment/service";
import { sniffAudio } from "@/lib/media/audio-store";
import { isSafeMediaId } from "@/lib/media/file-store";
import { MAX_AUDIO_BYTES, musicFiles } from "./audio";

/**
 * Background music for an owned copy (GAMEEXPLOR-0025): the database half.
 *
 * Mechanically this is `GameManual` with one file per row instead of a page
 * sequence, and it reuses the same on-disk store. Same stance as codes, maps,
 * bookmarks and manuals: no `source` column, no precedence. A track a skill
 * registered and a track the owner added are one kind of row.
 *
 * The write path is two steps — POST the row, then PUT the bytes — because a
 * JSON body and a multi-megabyte MP3 do not belong in one request. A track with
 * no bytes yet is a real state, not an error; it simply is not playable, so the
 * player never sees it.
 *
 * **The files are always the owner's own.** Nothing in this app fetches,
 * converts or generates audio, and there is no route that would let it: the
 * only way bytes get here is a PUT from someone holding the owner's token,
 * carrying a file they already had.
 */

/** A soundtrack is a couple of dozen tracks at most; this is a shelf, not a library. */
export const MAX_TRACKS_PER_GAME = 60;
export { MAX_AUDIO_BYTES };

export const trackInputSchema = z.object({
  /**
   * The piece as a human reads it. No charset restriction on purpose: "Étude",
   * "Zelda – Overworld" and "ドラキュラ伝説" are all ordinary track names, and an
   * ASCII-only rule would reject the real ones while stopping nothing — this
   * string never touches a path.
   */
  title: z.string().trim().min(1).max(120),
});
export type TrackInput = z.infer<typeof trackInputSchema>;

async function requireOwned(ownedGameId: string) {
  const owned = await prisma.ownedGame.findUnique({ where: { id: ownedGameId }, select: { id: true } });
  if (!owned) throw new EnrichmentError("owned game not found", 404);
  return owned;
}

async function requireTrack(trackId: string): Promise<MusicTrack> {
  const track = await prisma.musicTrack.findUnique({ where: { id: trackId } });
  if (!track) throw new EnrichmentError("track not found", 404);
  return track;
}

/**
 * Every track row for a copy, uploaded or not — the owner-facing listing behind
 * `GET /api/games/:id/music/all`.
 *
 * The public listing hides rows with no audio, so this is the only way to see
 * (and therefore delete) a row whose upload failed after its POST succeeded.
 */
export async function tracksFor(ownedGameId: string): Promise<MusicTrack[]> {
  return prisma.musicTrack.findMany({ where: { ownedGameId }, orderBy: { createdAt: "asc" } });
}

/**
 * What the player is allowed to know: ids and titles of the tracks that
 * actually have audio.
 *
 * A row with no bytes is left out rather than handed over — offering a track
 * that would 404 is worse than not mentioning it — and nothing here says
 * anything about the disk.
 */
export async function playableTracksFor(ownedGameId: string): Promise<{ id: string; title: string }[]> {
  const rows = await prisma.musicTrack.findMany({
    where: { ownedGameId, bytes: { gt: 0 } },
    select: { id: true, title: true },
    orderBy: { createdAt: "asc" },
  });
  return rows;
}

export async function addTrack(ownedGameId: string, input: TrackInput): Promise<MusicTrack> {
  await requireOwned(ownedGameId);
  if ((await prisma.musicTrack.count({ where: { ownedGameId } })) >= MAX_TRACKS_PER_GAME) {
    throw new EnrichmentError(`this game already has ${MAX_TRACKS_PER_GAME} tracks`, 409);
  }
  return prisma.musicTrack.create({ data: { ownedGameId, title: input.title } });
}

/**
 * Store the audio and record its size on the row.
 *
 * `sniffAudio` is the gate the content-type header is not: a PUT body is
 * whatever the caller sent, and a file that is not an MP3 would be a track that
 * exists, lists, and plays nothing.
 */
export async function setTrackAudio(trackId: string, buf: Buffer): Promise<MusicTrack> {
  await requireTrack(trackId);
  if (buf.length > MAX_AUDIO_BYTES) throw new EnrichmentError(`audio is larger than ${MAX_AUDIO_BYTES / 1024 / 1024} MB`, 413);
  const contentType = sniffAudio(buf);
  if (!contentType) throw new EnrichmentError("audio must be an MP3", 415);
  await musicFiles.write(trackId, buf, "mp3");
  return prisma.musicTrack.update({ where: { id: trackId }, data: { contentType, bytes: buf.length } });
}

/**
 * The stored file's location and size — everything the serve route needs to
 * answer a `Range` without reading a byte.
 *
 * Deliberately takes the id straight from the URL: `musicFiles` refuses
 * anything that is not a bare row id, so a hostile segment dies here rather
 * than turning into a path. Returns null for an id that is not a track, a track
 * whose audio was never uploaded, and a file that has since gone missing —
 * all of which are one 404 to the caller.
 */
export async function findTrackFile(trackId: string) {
  if (!isSafeMediaId(trackId)) return null;
  const track = await prisma.musicTrack.findUnique({ where: { id: trackId }, select: { id: true, contentType: true } });
  if (!track) return null;
  const file = await musicFiles.stat(trackId);
  return file ? { track, file } : null;
}

/** Remove a track and its file. The row goes first: a rolled-back delete that had already unlinked the audio would leave a track that plays nothing. */
export async function removeTrack(trackId: string): Promise<void> {
  await requireTrack(trackId);
  await prisma.musicTrack.delete({ where: { id: trackId } });
  await musicFiles.delete(trackId);
}
