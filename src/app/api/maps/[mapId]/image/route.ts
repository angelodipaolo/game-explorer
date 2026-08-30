import { NextRequest, NextResponse } from "next/server";
import { EnrichmentError } from "@/lib/enrichment/service";
import { handle, ok } from "@/lib/enrichment/http";
import { readImage } from "@/lib/maps/image";
import { setMapImage } from "@/lib/maps/service";

type Ctx = { params: Promise<{ mapId: string }> };

/** GET /api/maps/:mapId/image — the stored PNG/JPEG. 404 until one is uploaded. */
export async function GET(_req: NextRequest, ctx: Ctx) {
  return handle(async () => {
    const img = await readImage((await ctx.params).mapId);
    if (!img) throw new EnrichmentError("no image uploaded for this map", 404);
    return new NextResponse(new Uint8Array(img.buf), { headers: { "content-type": img.contentType, "cache-control": "private, max-age=0, must-revalidate" } });
  });
}

/**
 * PUT /api/maps/:mapId/image — raw image bytes as the body
 * (`curl -T map.png` or `--data-binary @map.png`). Records the pixel size on
 * the map so markers can be range-checked and the viewer knows the world size.
 */
export async function PUT(req: NextRequest, ctx: Ctx) {
  return handle(async () => {
    const buf = Buffer.from(await req.arrayBuffer());
    if (!buf.length) throw new EnrichmentError("empty body — send the image bytes", 400);
    return ok(await setMapImage((await ctx.params).mapId, buf));
  });
}
