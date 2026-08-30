import { NextRequest } from "next/server";
import { z } from "zod";
import { handle, ok } from "@/lib/enrichment/http";
import { listMapGaps } from "@/lib/maps/service";

const query = z.object({ limit: z.coerce.number().int().min(1).max(500).default(50), offset: z.coerce.number().int().min(0).default(0) });

/** GET /api/maps/gaps?limit=50&offset=0 — owned copies with no maps yet. */
export async function GET(req: NextRequest) {
  return handle(async () => {
    const q = query.parse(Object.fromEntries(req.nextUrl.searchParams));
    return ok(await listMapGaps(q.limit, q.offset));
  });
}
