import { NextRequest, NextResponse } from "next/server";
import { EnrichmentError } from "@/lib/enrichment/service";
import { handle, ok, readUploadBody } from "@/lib/enrichment/http";
import { readImage } from "@/lib/maps/image";
import { MAX_IMAGE_BYTES, isSafeImageId } from "@/lib/media/image-store";
import { setMapImage } from "@/lib/maps/service";

type Ctx = { params: Promise<{ mapId: string }> };

/**
 * GET /api/maps/:mapId/image — the stored PNG/JPEG. 404 until one is uploaded.
 *
 * This route is public (the allowlist in `src/proxy.ts`), so the id in the URL
 * is attacker-chosen. `isSafeImageId` is the same check the store enforces
 * anyway — repeated here only so a rejected id is a plain 404 rather than the
 * 500 an unhandled `ImageIdError` would become.
 */
export async function GET(_req: NextRequest, ctx: Ctx) {
  return handle(async () => {
    const { mapId } = await ctx.params;
    if (!isSafeImageId(mapId)) throw new EnrichmentError("no image uploaded for this map", 404);
    const img = await readImage(mapId);
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
    const { mapId } = await ctx.params;
    if (!isSafeImageId(mapId)) throw new EnrichmentError("no such map", 404);
    // `readUploadBody`, not a bare `arrayBuffer()`: a body over the framework's
    // proxy buffer used to arrive truncated with no error at all, and a PNG
    // header at the front is enough for `sniffImage` to wave half a file
    // through. See src/lib/enrichment/http.ts.
    const buf = await readUploadBody(req, MAX_IMAGE_BYTES, "image");
    return ok(await setMapImage(mapId, buf));
  });
}
