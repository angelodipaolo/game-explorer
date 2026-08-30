import { NextRequest } from "next/server";
import { EnrichmentError } from "@/lib/enrichment/service";
import { handle, ok } from "@/lib/enrichment/http";
import { mapById, mapPatchSchema, removeMap, updateMap } from "@/lib/maps/service";

type Ctx = { params: Promise<{ mapId: string }> };

/** GET /api/maps/:mapId — one map with its markers. */
export async function GET(_req: NextRequest, ctx: Ctx) {
  return handle(async () => {
    const map = await mapById((await ctx.params).mapId);
    if (!map) throw new EnrichmentError("map not found", 404);
    return ok(map);
  });
}

/** PATCH /api/maps/:mapId — title, slug, subtitle, sourceUrl, note, position. */
export async function PATCH(req: NextRequest, ctx: Ctx) {
  return handle(async () => ok(await updateMap((await ctx.params).mapId, mapPatchSchema.parse(await req.json()))));
}

/** DELETE /api/maps/:mapId — the map, its markers and its image file. */
export async function DELETE(_req: NextRequest, ctx: Ctx) {
  return handle(async () => {
    await removeMap((await ctx.params).mapId);
    return ok({ ok: true });
  });
}
