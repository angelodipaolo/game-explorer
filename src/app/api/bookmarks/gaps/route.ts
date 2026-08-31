import { NextRequest } from "next/server";
import { z } from "zod";
import { handle, ok } from "@/lib/enrichment/http";
import { BOOKMARK_KINDS, listBookmarkGaps } from "@/lib/bookmarks/service";

const query = z.object({
  kinds: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(500).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

/**
 * GET /api/bookmarks/gaps?kinds=guide,longplay&limit=50&offset=0
 *
 * The same shape as /api/codes/gaps, so find-references drives it exactly the
 * way find-codes drives that one. A static segment beats the sibling
 * [bookmarkId] route, the way /api/maps/gaps sits beside /api/maps/[mapId].
 */
export async function GET(req: NextRequest) {
  return handle(async () => {
    const q = query.parse(Object.fromEntries(req.nextUrl.searchParams));
    const kinds = q.kinds ? z.array(z.enum(BOOKMARK_KINDS)).parse(q.kinds.split(",")) : undefined;
    return ok(await listBookmarkGaps(kinds, q.limit, q.offset));
  });
}
