import type { GameMap, MapMarker } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { EnrichmentError } from "@/lib/enrichment/service";
import { platformLabel } from "@/lib/platforms";
import { deleteImage, sniffImage, writeImage } from "./image";
import { MARKER_KINDS, MAX_IMAGE_BYTES, MAX_MAPS_PER_GAME, MAX_MARKERS_PER_MAP, isMarkerKind, slugify } from "./kinds";

/**
 * Interactive maps for one owned copy: an image plus markers in image pixels.
 *
 * Same stance as codes: no `source`, no precedence, one API for the owner and
 * for research skills. A map is a list of places, not a contested value.
 *
 * The write path is deliberately two steps — create the map row, then PUT the
 * image bytes — because a JSON body and a multi-megabyte PNG do not belong in
 * one request, and because markers can be written before, after, or without
 * an image (the viewer shows a flat ground until one arrives).
 */

const text = (max: number) => z.string().trim().max(max).nullish();
const urlField = z.union([z.literal(""), z.string().trim().url().max(500)]).nullish();
const blank = (v: string | null | undefined) => (v === undefined ? undefined : v || null);

export const mapInputSchema = z.object({
  title: z.string().trim().min(1).max(80),
  /** Defaults to slugify(title). */
  slug: z.string().trim().min(1).max(60).regex(/^[a-z0-9-]+$/).optional(),
  subtitle: text(120),
  sourceUrl: urlField,
  note: text(500),
  position: z.number().int().min(0).max(999).optional(),
});
export type MapInput = z.infer<typeof mapInputSchema>;

export const mapPatchSchema = mapInputSchema.partial();
export type MapPatch = z.infer<typeof mapPatchSchema>;

const markerFields = {
  name: z.string().trim().min(1).max(80),
  kind: z.string().trim().min(1).max(20).optional(),
  x: z.number().int().min(0).max(65535),
  y: z.number().int().min(0).max(65535),
  note: text(300),
  sourceUrl: urlField,
  position: z.number().int().min(0).max(9999).optional(),
};
export const markerInputSchema = z.object(markerFields);
export type MarkerInput = z.infer<typeof markerInputSchema>;

/** The batch body: upsert by name. `replace: true` also removes markers not in the list. */
export const writeMarkersSchema = z.object({
  markers: z.array(markerInputSchema).max(MAX_MARKERS_PER_MAP),
  replace: z.boolean().optional(),
});

export const markerPatchSchema = z.object({ ...markerFields, name: markerFields.name.optional(), x: markerFields.x.optional(), y: markerFields.y.optional() });
export type MarkerPatch = z.infer<typeof markerPatchSchema>;

export type MapWithMarkers = GameMap & { markers: MapMarker[] };

export type MarkerWriteResult = {
  written: { name: string; id: string }[];
  skipped: { name: string; reason: string }[];
  removed: number;
};

async function requireOwned(ownedGameId: string) {
  const owned = await prisma.ownedGame.findUnique({ where: { id: ownedGameId }, select: { id: true } });
  if (!owned) throw new EnrichmentError("owned game not found", 404);
}

async function requireMap(mapId: string) {
  const map = await prisma.gameMap.findUnique({ where: { id: mapId } });
  if (!map) throw new EnrichmentError("map not found", 404);
  return map;
}

const byOrder = <T extends { position: number; createdAt: Date }>(a: T, b: T) => a.position - b.position || a.createdAt.getTime() - b.createdAt.getTime();

/** One copy's maps with their markers, in display order. */
export async function mapsFor(ownedGameId: string): Promise<MapWithMarkers[]> {
  const rows = await prisma.gameMap.findMany({ where: { ownedGameId }, include: { markers: true } });
  return rows.sort(byOrder).map((m) => ({ ...m, markers: m.markers.sort(byOrder) }));
}

export async function mapById(mapId: string): Promise<MapWithMarkers | null> {
  const m = await prisma.gameMap.findUnique({ where: { id: mapId }, include: { markers: true } });
  return m ? { ...m, markers: m.markers.sort(byOrder) } : null;
}

/**
 * Create a map, or refresh the one already there under that slug — so a
 * skill re-run updates the title and source rather than stacking a duplicate.
 */
export async function addMap(ownedGameId: string, input: MapInput) {
  await requireOwned(ownedGameId);
  const slug = input.slug ?? slugify(input.title);
  if (!slug) throw new EnrichmentError("title does not make a usable slug", 400);
  const where = { ownedGameId_slug: { ownedGameId, slug } };
  const existing = await prisma.gameMap.findUnique({ where });
  if (!existing && (await prisma.gameMap.count({ where: { ownedGameId } })) >= MAX_MAPS_PER_GAME) {
    throw new EnrichmentError(`this game already has ${MAX_MAPS_PER_GAME} maps`, 409);
  }
  const d = { title: input.title, subtitle: blank(input.subtitle), sourceUrl: blank(input.sourceUrl), note: blank(input.note), position: input.position };
  return prisma.gameMap.upsert({
    where,
    create: { ownedGameId, slug, ...d, subtitle: d.subtitle ?? null, sourceUrl: d.sourceUrl ?? null, note: d.note ?? null, position: d.position ?? 0 },
    update: d,
  });
}

export async function updateMap(mapId: string, patch: MapPatch) {
  const row = await requireMap(mapId);
  if (patch.slug && patch.slug !== row.slug) {
    const clash = await prisma.gameMap.findUnique({ where: { ownedGameId_slug: { ownedGameId: row.ownedGameId, slug: patch.slug } } });
    if (clash) throw new EnrichmentError("this game already has a map with that slug", 409);
  }
  return prisma.gameMap.update({ where: { id: mapId }, data: { title: patch.title, slug: patch.slug, subtitle: blank(patch.subtitle), sourceUrl: blank(patch.sourceUrl), note: blank(patch.note), position: patch.position } });
}

export async function removeMap(mapId: string) {
  await requireMap(mapId);
  await prisma.gameMap.delete({ where: { id: mapId } });
  await deleteImage(mapId);
}

/** Store the image bytes and record their pixel size on the map row. */
export async function setMapImage(mapId: string, buf: Buffer) {
  await requireMap(mapId);
  if (buf.length > MAX_IMAGE_BYTES) throw new EnrichmentError(`image is larger than ${MAX_IMAGE_BYTES / 1024 / 1024} MB`, 413);
  const info = sniffImage(buf);
  if (!info) throw new EnrichmentError("image must be a PNG or JPEG", 415);
  await writeImage(mapId, buf, info);
  return prisma.gameMap.update({ where: { id: mapId }, data: { width: info.width, height: info.height } });
}

function markerData(m: MarkerInput | MarkerPatch) {
  return { kind: m.kind, x: m.x, y: m.y, note: blank(m.note), sourceUrl: blank(m.sourceUrl), position: m.position };
}

/**
 * Upsert markers by name. Partial success: an unknown kind or an off-image
 * point is reported in `skipped` and the rest still land. With `replace`,
 * markers not named in the batch are removed — the shape a skill wants when it
 * re-derives a whole map from a fresh read of the image.
 */
export async function writeMarkers(mapId: string, markers: MarkerInput[], replace = false): Promise<MarkerWriteResult> {
  const map = await requireMap(mapId);
  const result: MarkerWriteResult = { written: [], skipped: [], removed: 0 };
  const seen = new Set<string>();
  let count = await prisma.mapMarker.count({ where: { mapId } });
  for (const m of markers) {
    const kind = m.kind ?? "other";
    if (!isMarkerKind(kind)) {
      result.skipped.push({ name: m.name, reason: `unknown kind — expected one of ${MARKER_KINDS.join(", ")}` });
      continue;
    }
    if (map.width && map.height && (m.x > map.width || m.y > map.height)) {
      result.skipped.push({ name: m.name, reason: `(${m.x}, ${m.y}) is outside the ${map.width}×${map.height} image` });
      continue;
    }
    if (seen.has(m.name)) {
      result.skipped.push({ name: m.name, reason: "named twice in this batch" });
      continue;
    }
    seen.add(m.name);
    const where = { mapId_name: { mapId, name: m.name } };
    const existing = await prisma.mapMarker.findUnique({ where, select: { id: true } });
    if (!existing) {
      if (count >= MAX_MARKERS_PER_MAP) {
        result.skipped.push({ name: m.name, reason: `already at the ${MAX_MARKERS_PER_MAP}-marker limit` });
        continue;
      }
      count++;
    }
    const d = { ...markerData(m), kind };
    const row = await prisma.mapMarker.upsert({
      where,
      create: { mapId, name: m.name, ...d, x: m.x, y: m.y, note: d.note ?? null, sourceUrl: d.sourceUrl ?? null, position: d.position ?? 0 },
      update: d,
    });
    result.written.push({ name: m.name, id: row.id });
  }
  if (replace) {
    const { count: removed } = await prisma.mapMarker.deleteMany({ where: { mapId, name: { notIn: [...seen] } } });
    result.removed = removed;
  }
  return result;
}

export async function updateMarker(mapId: string, markerId: string, patch: MarkerPatch) {
  const row = await prisma.mapMarker.findFirst({ where: { id: markerId, mapId } });
  if (!row) throw new EnrichmentError("marker not found", 404);
  if (patch.kind !== undefined && !isMarkerKind(patch.kind)) throw new EnrichmentError(`unknown kind — expected one of ${MARKER_KINDS.join(", ")}`, 400);
  if (patch.name && patch.name !== row.name) {
    const clash = await prisma.mapMarker.findUnique({ where: { mapId_name: { mapId, name: patch.name } } });
    if (clash) throw new EnrichmentError("this map already has a marker with that name", 409);
  }
  return prisma.mapMarker.update({ where: { id: markerId }, data: { name: patch.name, ...markerData(patch) } });
}

export async function removeMarker(mapId: string, markerId: string) {
  const { count } = await prisma.mapMarker.deleteMany({ where: { id: markerId, mapId } });
  if (!count) throw new EnrichmentError("marker not found", 404);
}

export type MapGap = { ownedGameId: string; title: string; name: string; platform: string; year: number | null; igdbId: number | null; maps: number };

/** Owned copies with no maps yet, alphabetically — what a research pass works through. */
export async function listMapGaps(limit = 50, offset = 0): Promise<{ total: number; gaps: MapGap[] }> {
  const owned = await prisma.ownedGame.findMany({ include: { catalogGame: { select: { name: true, igdbId: true, firstReleaseDate: true } }, _count: { select: { maps: true } } }, orderBy: { title: "asc" } });
  const gaps = owned
    .filter((g) => g._count.maps === 0)
    .map((g) => ({ ownedGameId: g.id, title: g.title, name: g.catalogGame?.name ?? g.title, platform: platformLabel(g.platform), year: g.catalogGame?.firstReleaseDate?.getUTCFullYear() ?? null, igdbId: g.catalogGame?.igdbId ?? null, maps: 0 }));
  return { total: gaps.length, gaps: gaps.slice(offset, offset + limit) };
}

export type { GameMap, MapMarker };
export { MARKER_KINDS, MAX_MARKERS_PER_MAP, MAX_MAPS_PER_GAME, isMarkerKind, type MarkerKind } from "./kinds";
