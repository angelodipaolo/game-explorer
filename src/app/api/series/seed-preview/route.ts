import { NextRequest } from "next/server";
import { z } from "zod";
import { liveCatalog } from "@/lib/catalog";
import { handle, ok } from "@/lib/enrichment/http";

const schema = z.object({ collectionId: z.number().int().positive() });

/**
 * POST /api/series/seed-preview { collectionId }
 *
 * The propose-members path: IGDB's whole collection, hydrated into the catalog
 * (full rows or stubs), ports and remakes collapsed through `parentIgdbId`,
 * ordered by first release date and marked with what you already own. Nothing
 * is written to `Series` — the owner prunes this list and POSTs what is left.
 *
 * `skipped` is the member ids that came back empty: every /games query carries
 * the game_type filter, so a DLC or an episode in the collection is simply not
 * returned, and it is reported rather than silently dropped.
 */
export async function POST(req: NextRequest) {
  return handle(async () => {
    const { collectionId } = schema.parse(await req.json());
    return ok(await liveCatalog().proposeMembers(collectionId));
  });
}
