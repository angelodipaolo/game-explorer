import { NextRequest } from "next/server";
import { handle, ok } from "@/lib/enrichment/http";
import { EnrichmentError } from "@/lib/enrichment/service";
import { deleteSeries, seriesById, seriesPatchSchema, updateSeries } from "@/lib/series/service";

type Ctx = { params: Promise<{ seriesId: string }> };

/** GET /api/series/:seriesId — the series with its entries resolved against the shelf. */
export async function GET(_req: NextRequest, ctx: Ctx) {
  return handle(async () => {
    const view = await seriesById((await ctx.params).seriesId);
    // Thrown, not hand-rolled: every 404 in this API carries the same
    // { error, details } body, which is what `apiError` in the client reads.
    if (!view) throw new EnrichmentError("series not found", 404);
    return ok(view);
  });
}

/** PATCH /api/series/:seriesId — name, slug, blurb, cover override, position, seed collection. */
export async function PATCH(req: NextRequest, ctx: Ctx) {
  return handle(async () => ok(await updateSeries((await ctx.params).seriesId, seriesPatchSchema.parse(await req.json()))));
}

/** DELETE /api/series/:seriesId — entries go with it by cascade. */
export async function DELETE(_req: NextRequest, ctx: Ctx) {
  return handle(async () => {
    await deleteSeries((await ctx.params).seriesId);
    return ok({ ok: true });
  });
}
