import { NextRequest } from "next/server";
import { handle, ok } from "@/lib/enrichment/http";
import { addCodes, writeCodesSchema } from "@/lib/codes/service";

/**
 * POST /api/codes { codes: [{ ownedGameId, kind, effect, … }] }
 *
 * A batch endpoint, not an agent endpoint: the same body as the single-game
 * POST plus `ownedGameId`, for anything writing more than one row. Partial
 * success — bad entries come back in `skipped` with a reason.
 */
export async function POST(req: NextRequest) {
  return handle(async () => ok(await addCodes(writeCodesSchema.parse(await req.json()).codes)));
}
