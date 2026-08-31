import { NextRequest } from "next/server";
import { handle, ok } from "@/lib/enrichment/http";
import { entryPatchSchema, removeEntries, updateEntry } from "@/lib/series/service";
import { prisma } from "@/lib/db";
import { EnrichmentError } from "@/lib/enrichment/service";

type Ctx = { params: Promise<{ entryId: string }> };

/**
 * One entry at a time — the fallback path, and how a section or a note gets
 * attached after a prune. Its own top-level route rather than
 * /api/series/:id/entries/:entryId, following /api/manual-pages/:pageId: an
 * entry id identifies the series it is in already.
 */
export async function PATCH(req: NextRequest, ctx: Ctx) {
  return handle(async () => ok(await updateEntry((await ctx.params).entryId, entryPatchSchema.parse(await req.json()))));
}

/** DELETE /api/series-entries/:entryId — removes it and closes the gap in `position`. */
export async function DELETE(_req: NextRequest, ctx: Ctx) {
  return handle(async () => {
    const { entryId } = await ctx.params;
    const row = await prisma.seriesEntry.findUnique({ where: { id: entryId }, select: { seriesId: true } });
    if (!row) throw new EnrichmentError("series entry not found", 404);
    return ok(await removeEntries(row.seriesId, [entryId]));
  });
}
