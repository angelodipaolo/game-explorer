import { NextRequest, NextResponse } from "next/server";
import { EnrichmentError } from "@/lib/enrichment/service";
import { handle, ok } from "@/lib/enrichment/http";
import { readEntryImage, setEntryImage } from "@/lib/journal/service";

type Ctx = { params: Promise<{ entryId: string }> };

/**
 * GET /api/journal/:entryId/image — the stored photo. 404 until one is
 * uploaded. `private` because this is the owner's camera roll, not cover art.
 */
export async function GET(_req: NextRequest, ctx: Ctx) {
  return handle(async () => {
    const img = await readEntryImage((await ctx.params).entryId);
    if (!img) throw new EnrichmentError("no image uploaded for this entry", 404);
    return new NextResponse(new Uint8Array(img.buf), { headers: { "content-type": img.contentType, "cache-control": "private, max-age=0, must-revalidate" } });
  });
}

/**
 * PUT /api/journal/:entryId/image — raw image bytes as the body
 * (`curl -T shot.jpg` or `--data-binary @shot.jpg`). Records the pixel size on
 * the entry so the feed can lay the thumbnail out before the bytes arrive.
 */
export async function PUT(req: NextRequest, ctx: Ctx) {
  return handle(async () => {
    const buf = Buffer.from(await req.arrayBuffer());
    if (!buf.length) throw new EnrichmentError("empty body — send the image bytes", 400);
    return ok(await setEntryImage((await ctx.params).entryId, buf));
  });
}
