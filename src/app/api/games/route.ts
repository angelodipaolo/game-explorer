import { NextRequest } from "next/server";
import { handle, ok } from "@/lib/enrichment/http";
import { listGames, parseListQuery } from "@/lib/games/service";

/**
 * GET /api/games?q=sonic&platform=nes&platform=snes&limit=50&cursor=…
 *
 * List and search the shelf — the endpoint that lets an agent turn a name into
 * an id (GAMEEXPLOR-0028). Before this existed the only routes that returned
 * more than one game were the per-domain `gaps` work queues, each of which
 * returns games *missing* something, which is not a collection.
 *
 * Owner-only, like every other agent-facing enumeration here (`/api/tags`,
 * `/api/codes/gaps`). It is not on the proxy's public allowlist and must not
 * be: the public pages are made of covers and one game at a time, not of a
 * machine-readable index of everything the owner has in the house.
 *
 * The query string is read by `parseListQuery` rather than here, because
 * repeatable `platform` and empty-means-absent are rules worth a unit test.
 */
export async function GET(req: NextRequest) {
  return handle(async () => ok(await listGames(parseListQuery(req.nextUrl.searchParams))));
}
