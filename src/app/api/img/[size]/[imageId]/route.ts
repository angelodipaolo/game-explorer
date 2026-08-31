import { serveImage } from "@/lib/images/serve";

type Ctx = { params: Promise<{ size: string; imageId: string }> };

/**
 * GET /api/img/:size/:imageId — IGDB cover art and screenshots, served from
 * the local disk cache and backfilled on a miss. See src/lib/images/serve.ts.
 */
export async function GET(_req: Request, ctx: Ctx) {
  const { size, imageId } = await ctx.params;
  return serveImage(size, imageId);
}
