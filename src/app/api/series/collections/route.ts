import { NextRequest } from "next/server";
import { liveCatalog } from "@/lib/catalog";
import { handle, ok } from "@/lib/enrichment/http";
import { EnrichmentError } from "@/lib/enrichment/service";

/**
 * GET /api/series/collections?igdbId=1029
 *
 * Discovery: the IGDB collections a game belongs to, so the owner finds a
 * collection id by picking a game they own rather than by knowing IGDB's
 * numbering. Reads the ids cached on the catalog row when they are there and
 * falls back to IGDB's reverse lookup.
 *
 * A game is often in several ("Final Fantasy", "Compilation of Final Fantasy
 * VII", "Final Fantasy VII"), which is exactly why something has to choose —
 * see the probe note. Also accepts ?collectionId= to name a single collection.
 */
export async function GET(req: NextRequest) {
  return handle(async () => {
    const catalog = liveCatalog();
    const collectionId = Number(req.nextUrl.searchParams.get("collectionId"));
    if (Number.isInteger(collectionId) && collectionId > 0) {
      const one = await catalog.collection(collectionId);
      return ok(one ? [one] : []);
    }
    const igdbId = Number(req.nextUrl.searchParams.get("igdbId"));
    if (!Number.isInteger(igdbId) || igdbId <= 0) throw new EnrichmentError("pass ?igdbId= (a game) or ?collectionId=", 400);
    return ok(await catalog.collectionsForGame(igdbId));
  });
}
