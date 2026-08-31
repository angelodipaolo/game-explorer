import { NextRequest } from "next/server";
import { handle, ok } from "@/lib/enrichment/http";
import { addPage, pageInputSchema, reorderPages, reorderPagesSchema } from "@/lib/manuals/service";

type Ctx = { params: Promise<{ manualId: string }> };

/**
 * POST /api/manuals/:manualId/pages { label?, position? }
 * Appends an empty page row (or inserts it at `position`, shifting the rest
 * down). PUT the scan to /api/manual-pages/:pageId/image next — a JSON body
 * and a multi-megabyte scan do not belong in one request.
 */
export async function POST(req: NextRequest, ctx: Ctx) {
  return handle(async () => {
    const { manualId } = await ctx.params;
    return ok(await addPage(manualId, pageInputSchema.parse(await req.json().catch(() => ({})))), 201);
  });
}

/**
 * PATCH /api/manuals/:manualId/pages { orderedIds: [...] } — reorder.
 * The list must name every page of this manual exactly once; a partial list is
 * rejected rather than silently pushing the pages it forgot to the end.
 */
export async function PATCH(req: NextRequest, ctx: Ctx) {
  return handle(async () => {
    const { manualId } = await ctx.params;
    return ok(await reorderPages(manualId, reorderPagesSchema.parse(await req.json()).orderedIds));
  });
}
