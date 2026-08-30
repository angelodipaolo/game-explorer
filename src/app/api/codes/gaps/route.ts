import { NextRequest } from "next/server";
import { z } from "zod";
import { handle, ok } from "@/lib/enrichment/http";
import { CODE_KINDS, listCodeGaps } from "@/lib/codes/service";

const query = z.object({
  kinds: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(500).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

/**
 * GET /api/codes/gaps?kinds=game-genie,password&limit=50&offset=0
 *
 * Outside /api/enrichment on purpose: that namespace is the player-fact
 * enrichment loop, which codes are not part of.
 */
export async function GET(req: NextRequest) {
  return handle(async () => {
    const q = query.parse(Object.fromEntries(req.nextUrl.searchParams));
    const kinds = q.kinds ? z.array(z.enum(CODE_KINDS)).parse(q.kinds.split(",")) : undefined;
    return ok(await listCodeGaps(kinds, q.limit, q.offset));
  });
}
