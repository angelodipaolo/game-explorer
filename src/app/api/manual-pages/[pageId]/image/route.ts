import { NextRequest, NextResponse } from "next/server";
import { EnrichmentError } from "@/lib/enrichment/service";
import { handle, ok, readUploadBody } from "@/lib/enrichment/http";
import { readPageImage, setPageImage } from "@/lib/manuals/service";
import { MAX_IMAGE_BYTES, isSafeImageId } from "@/lib/media/image-store";

type Ctx = { params: Promise<{ pageId: string }> };

/**
 * GET /api/manual-pages/:pageId/image — the stored scan. 404 until one is
 * uploaded.
 *
 * Public, like the map and journal image routes (`src/proxy.ts`): a visitor's
 * manual viewer has to load the pixels. The id in the URL is therefore
 * attacker-chosen, and `isSafeImageId` — the same check the store enforces —
 * is repeated here so a rejected id is a plain 404 rather than a 500.
 */
export async function GET(_req: NextRequest, ctx: Ctx) {
  return handle(async () => {
    const { pageId } = await ctx.params;
    if (!isSafeImageId(pageId)) throw new EnrichmentError("no image uploaded for this page", 404);
    const img = await readPageImage(pageId);
    if (!img) throw new EnrichmentError("no image uploaded for this page", 404);
    return new NextResponse(new Uint8Array(img.buf), { headers: { "content-type": img.contentType, "cache-control": "private, max-age=0, must-revalidate" } });
  });
}

/**
 * PUT /api/manual-pages/:pageId/image — raw image bytes as the body
 * (`curl -T page-01.jpg` or `--data-binary @page-01.jpg`). Records the pixel
 * size on the page so the viewer can hold its shape before the bytes arrive.
 */
export async function PUT(req: NextRequest, ctx: Ctx) {
  return handle(async () => {
    const { pageId } = await ctx.params;
    if (!isSafeImageId(pageId)) throw new EnrichmentError("no such page", 404);
    // `readUploadBody`, not a bare `arrayBuffer()`: a body over the framework's
    // proxy buffer used to arrive truncated with no error at all, and a PNG
    // header at the front is enough for `sniffImage` to wave half a file
    // through. See src/lib/enrichment/http.ts.
    const buf = await readUploadBody(req, MAX_IMAGE_BYTES, "image");
    return ok(await setPageImage(pageId, buf));
  });
}
