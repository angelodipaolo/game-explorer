import { NextRequest } from "next/server";
import { handle, ok } from "@/lib/enrichment/http";
import { writeMarkers, writeMarkersSchema } from "@/lib/maps/service";

type Ctx = { params: Promise<{ mapId: string }> };

/**
 * POST /api/maps/:mapId/markers { markers: [{ name, kind?, x, y, note?, sourceUrl? }], replace? }
 * Upserts by name; `replace: true` also drops markers not in the list.
 * Partial success — bad entries come back in `skipped` with a reason.
 */
export async function POST(req: NextRequest, ctx: Ctx) {
  return handle(async () => {
    const body = writeMarkersSchema.parse(await req.json());
    return ok(await writeMarkers((await ctx.params).mapId, body.markers, body.replace ?? false));
  });
}
