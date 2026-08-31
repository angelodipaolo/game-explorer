import { NextRequest } from "next/server";
import { handle, ok } from "@/lib/enrichment/http";
import { createManual, manualInputSchema, manualsFor } from "@/lib/manuals/service";

type Ctx = { params: Promise<{ id: string }> };

/** GET /api/games/:id/manuals — this copy's manuals with their pages, in reading order. */
export async function GET(_req: NextRequest, ctx: Ctx) {
  return handle(async () => ok(await manualsFor((await ctx.params).id)));
}

/**
 * POST /api/games/:id/manuals { title?, sourceUrl?, note? }
 * Creates the manual row. Add pages next with POST /api/manuals/:manualId/pages,
 * then PUT the bytes of each to /api/manual-pages/:pageId/image.
 */
export async function POST(req: NextRequest, ctx: Ctx) {
  return handle(async () => {
    const { id } = await ctx.params;
    return ok(await createManual(id, manualInputSchema.parse(await req.json().catch(() => ({})))), 201);
  });
}
