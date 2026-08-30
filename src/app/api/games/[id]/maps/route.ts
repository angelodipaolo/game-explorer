import { NextRequest } from "next/server";
import { handle, ok } from "@/lib/enrichment/http";
import { addMap, mapInputSchema, mapsFor } from "@/lib/maps/service";

type Ctx = { params: Promise<{ id: string }> };

/** GET /api/games/:id/maps — this copy's maps with their markers. */
export async function GET(_req: NextRequest, ctx: Ctx) {
  return handle(async () => ok(await mapsFor((await ctx.params).id)));
}

/**
 * POST /api/games/:id/maps { title, slug?, subtitle?, sourceUrl?, note? }
 * Creates the map row (or refreshes the one with that slug). Upload the image
 * next with PUT /api/maps/:mapId/image, then write markers.
 */
export async function POST(req: NextRequest, ctx: Ctx) {
  return handle(async () => {
    const { id } = await ctx.params;
    return ok(await addMap(id, mapInputSchema.parse(await req.json())), 201);
  });
}
