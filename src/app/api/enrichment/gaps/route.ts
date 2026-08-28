import { NextRequest } from "next/server";
import { z } from "zod";
import { FACT_FIELDS } from "@/lib/facts";
import { handle, ok } from "@/lib/enrichment/http";
import { listGaps } from "@/lib/enrichment/service";

const query = z.object({
  fields: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(500).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

/** GET /api/enrichment/gaps?fields=maxPlayers,simultaneousPlay&limit=50&offset=0 */
export async function GET(req: NextRequest) {
  return handle(async () => {
    const q = query.parse(Object.fromEntries(req.nextUrl.searchParams));
    const fields = q.fields ? z.array(z.enum(FACT_FIELDS)).parse(q.fields.split(",")) : undefined;
    return ok(await listGaps(fields, q.limit, q.offset));
  });
}
