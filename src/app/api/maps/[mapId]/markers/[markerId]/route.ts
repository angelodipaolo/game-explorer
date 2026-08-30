import { NextRequest } from "next/server";
import { handle, ok } from "@/lib/enrichment/http";
import { markerPatchSchema, removeMarker, updateMarker } from "@/lib/maps/service";

type Ctx = { params: Promise<{ mapId: string; markerId: string }> };

/** PATCH /api/maps/:mapId/markers/:markerId */
export async function PATCH(req: NextRequest, ctx: Ctx) {
  return handle(async () => {
    const { mapId, markerId } = await ctx.params;
    return ok(await updateMarker(mapId, markerId, markerPatchSchema.parse(await req.json())));
  });
}

/** DELETE /api/maps/:mapId/markers/:markerId */
export async function DELETE(_req: NextRequest, ctx: Ctx) {
  return handle(async () => {
    const { mapId, markerId } = await ctx.params;
    await removeMarker(mapId, markerId);
    return ok({ ok: true });
  });
}
