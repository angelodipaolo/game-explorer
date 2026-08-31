import { NextRequest } from "next/server";
import { handle, ok } from "@/lib/enrichment/http";
import { addBookmarks, writeBookmarksSchema } from "@/lib/bookmarks/service";

/**
 * POST /api/bookmarks { bookmarks: [{ ownedGameId, kind, url, title, why, … }] }
 *
 * A batch endpoint, not an agent endpoint: the same body as the single-game
 * POST plus `ownedGameId`, for anything writing more than one row. Partial
 * success — bad entries come back in `skipped` with a reason.
 */
export async function POST(req: NextRequest) {
  return handle(async () => ok(await addBookmarks(writeBookmarksSchema.parse(await req.json()).bookmarks)));
}
