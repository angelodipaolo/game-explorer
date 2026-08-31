import { NextRequest } from "next/server";
import { handle, ok } from "@/lib/enrichment/http";
import { addEntry, entriesFor, entryInputSchema } from "@/lib/journal/service";

type Ctx = { params: Promise<{ id: string }> };

/** GET /api/games/:id/journal — this copy's entries, newest first. */
export async function GET(_req: NextRequest, ctx: Ctx) {
  return handle(async () => ok(await entriesFor((await ctx.params).id)));
}

/**
 * POST /api/games/:id/journal { kind, title?, body?, occurredAt?, sessionId? }
 *
 * A `note` needs a body. A `photo` creates an empty row and the bytes follow
 * as `PUT /api/journal/:entryId/image` — a JSON body and a 4 MB phone photo do
 * not belong in one request.
 */
export async function POST(req: NextRequest, ctx: Ctx) {
  return handle(async () => {
    const { id } = await ctx.params;
    return ok(await addEntry(id, entryInputSchema.parse(await req.json())), 201);
  });
}
