import { NextRequest } from "next/server";
import { handle, ok } from "@/lib/enrichment/http";
import { tracksFor } from "@/lib/music/service";

type Ctx = { params: Promise<{ id: string }> };

/**
 * GET /api/games/:id/music/all — every track row for this copy, uploaded or
 * not. Owner only.
 *
 * The public route (`/api/games/:id/music`) lists only tracks that have audio,
 * which is right for the player but leaves a real hole: a POST that succeeded
 * followed by a PUT that failed leaves a row with `bytes = 0` that no read path
 * can see, that nothing can therefore delete — the id is gone — and that still
 * counts toward `MAX_TRACKS_PER_GAME`. This is the route that finds it.
 *
 * **Why a separate path rather than `?all=1`.** `isPublicApi` in src/proxy.ts
 * matches `^/api/games/[^/]+/music$` against the *pathname*, so a query
 * parameter on the public route would inherit its exemption and publish
 * everything here. A distinct path segment is what keeps the anchored regex
 * from matching, and it is the reason this is not one route with a flag.
 */
export async function GET(_req: NextRequest, ctx: Ctx) {
  return handle(async () => ok({ tracks: await tracksFor((await ctx.params).id) }));
}
