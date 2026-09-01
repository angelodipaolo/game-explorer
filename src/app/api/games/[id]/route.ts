import { NextRequest } from "next/server";
import { handle, ok } from "@/lib/enrichment/http";
import { EnrichmentError } from "@/lib/enrichment/service";
import { deleteGame, gameById, gamePatchSchema, updateGame } from "@/lib/games/service";

type Ctx = { params: Promise<{ id: string }> };

/** GET /api/games/:id — one owned copy, with a count of each sub-resource already hanging off it. */
export async function GET(_req: NextRequest, ctx: Ctx) {
  return handle(async () => {
    const game = await gameById((await ctx.params).id);
    // Thrown, not hand-rolled, so every 404 in this API carries the same
    // { error, details } body.
    if (!game) throw new EnrichmentError("owned game not found", 404);
    return ok(game);
  });
}

/**
 * PATCH /api/games/:id { platform?, quantity?, condition?, igdbId? }
 *
 * Corrects what an import got wrong. `igdbId` (spelled `catalogGameId` if you
 * prefer the column name) re-runs the catalog sync rather than writing the
 * column, so a re-linked game ends up with the same catalog row an import
 * would have given it; `null` unlinks.
 */
export async function PATCH(req: NextRequest, ctx: Ctx) {
  return handle(async () => ok(await updateGame((await ctx.params).id, gamePatchSchema.parse(await req.json()))));
}

/**
 * DELETE /api/games/:id — the copy, its cascaded rows, and the map, manual,
 * journal and music files on disk that a SQL cascade leaves behind.
 *
 * One id at a time and no bulk form anywhere: this is the only write path in
 * the app that destroys data with no undo behind it — import has batches,
 * facts have precedence, codes and maps are re-addable — and a batch mistake
 * here is unrecoverable.
 *
 * `409` while a run is open, so a delete cannot silently destroy a playthrough
 * in progress.
 */
export async function DELETE(_req: NextRequest, ctx: Ctx) {
  return handle(async () => ok(await deleteGame((await ctx.params).id)));
}
