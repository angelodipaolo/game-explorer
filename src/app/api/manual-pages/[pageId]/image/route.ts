import { NextRequest, NextResponse } from "next/server";
import { EnrichmentError } from "@/lib/enrichment/service";
import { handle, ok } from "@/lib/enrichment/http";
import { readPageImage, setPageImage } from "@/lib/manuals/service";

type Ctx = { params: Promise<{ pageId: string }> };

/**
 * GET /api/manual-pages/:pageId/image — the stored scan. 404 until one is
 * uploaded. `private` like the journal photo route: this is a scan on the
 * owner's disk, not cover art from a CDN.
 */
export async function GET(_req: NextRequest, ctx: Ctx) {
  return handle(async () => {
    const img = await readPageImage((await ctx.params).pageId);
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
    const buf = Buffer.from(await req.arrayBuffer());
    if (!buf.length) throw new EnrichmentError("empty body — send the image bytes", 400);
    return ok(await setPageImage((await ctx.params).pageId, buf));
  });
}
