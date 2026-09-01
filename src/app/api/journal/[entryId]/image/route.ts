import { NextRequest, NextResponse } from "next/server";
import { EnrichmentError } from "@/lib/enrichment/service";
import { handle, ok, readUploadBody } from "@/lib/enrichment/http";
import { readEntryImage, setEntryImage } from "@/lib/journal/service";
import { MAX_IMAGE_BYTES, isSafeImageId } from "@/lib/media/image-store";

type Ctx = { params: Promise<{ entryId: string }> };

/**
 * GET /api/journal/:entryId/image — the stored photo. 404 until one is
 * uploaded.
 *
 * **This route is public.** It is on the allowlist in `src/proxy.ts` so the
 * `<img>` tags on the game page render for a signed-out visitor, which means
 * anyone with the link can fetch any journal photo whose entry id they have —
 * the ids are on the public game page. That is the accepted design of a public
 * collection site (ops/README.md and data/README.md say so in as many words),
 * not something `cache-control` can fix: `no-store` keeps the bytes out of
 * shared caches, which is hygiene, never access control.
 *
 * The id is therefore attacker-chosen. `isSafeImageId` is the same check the
 * store enforces anyway — repeated here only so a rejected id is a plain 404
 * rather than the 500 an unhandled `ImageIdError` would become.
 */
export async function GET(_req: NextRequest, ctx: Ctx) {
  return handle(async () => {
    const { entryId } = await ctx.params;
    if (!isSafeImageId(entryId)) throw new EnrichmentError("no image uploaded for this entry", 404);
    const img = await readEntryImage(entryId);
    if (!img) throw new EnrichmentError("no image uploaded for this entry", 404);
    return new NextResponse(new Uint8Array(img.buf), { headers: { "content-type": img.contentType, "cache-control": "no-store" } });
  });
}

/**
 * PUT /api/journal/:entryId/image — raw image bytes as the body
 * (`curl -T shot.jpg` or `--data-binary @shot.jpg`). Records the pixel size on
 * the entry so the feed can lay the thumbnail out before the bytes arrive.
 */
export async function PUT(req: NextRequest, ctx: Ctx) {
  return handle(async () => {
    const { entryId } = await ctx.params;
    if (!isSafeImageId(entryId)) throw new EnrichmentError("no such entry", 404);
    // `readUploadBody`, not a bare `arrayBuffer()`: a body over the framework's
    // proxy buffer used to arrive truncated with no error at all, and a PNG
    // header at the front is enough for `sniffImage` to wave half a file
    // through. See src/lib/enrichment/http.ts.
    const buf = await readUploadBody(req, MAX_IMAGE_BYTES, "image");
    return ok(await setEntryImage(entryId, buf));
  });
}
