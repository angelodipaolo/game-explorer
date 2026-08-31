import { NextRequest } from "next/server";
import { handle, ok } from "@/lib/enrichment/http";
import { addEntries, addEntriesSchema, removeEntries, removeEntriesSchema, reorderEntries, reorderEntriesSchema } from "@/lib/series/service";

type Ctx = { params: Promise<{ seriesId: string }> };

/**
 * Batch entry operations, one route per verb:
 *
 * POST   { entries: [{ igdbId | title, section?, note?, sourceUrl? }], seen? }
 *   Appends. An id already in this series comes back in `skipped` rather than
 *   failing the batch. `seen` records what the owner was offered — including
 *   what they turned down — so "check for new entries" stays honest.
 *   `entries` may be empty when `seen` is not: a seed check where every
 *   candidate was rejected still has to be recordable, or those same ids come
 *   back as new on the next check. 201 only when something was created.
 * PATCH  { orderedIds: [...] } — reorder by permutation: every entry of this
 *   series exactly once, checked and renumbered in one transaction.
 * DELETE { ids: [...] } — remove several, then close the gap so positions
 *   stay dense.
 */
export async function POST(req: NextRequest, ctx: Ctx) {
  return handle(async () => {
    const { seriesId } = await ctx.params;
    const body = addEntriesSchema.parse(await req.json());
    const result = await addEntries(seriesId, body.entries, { seen: body.seen });
    return ok(result, result.added.length ? 201 : 200);
  });
}

export async function PATCH(req: NextRequest, ctx: Ctx) {
  return handle(async () => {
    const { seriesId } = await ctx.params;
    return ok(await reorderEntries(seriesId, reorderEntriesSchema.parse(await req.json()).orderedIds));
  });
}

export async function DELETE(req: NextRequest, ctx: Ctx) {
  return handle(async () => {
    const { seriesId } = await ctx.params;
    return ok(await removeEntries(seriesId, removeEntriesSchema.parse(await req.json()).ids));
  });
}
