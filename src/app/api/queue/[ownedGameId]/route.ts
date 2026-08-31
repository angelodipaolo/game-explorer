import { NextRequest } from "next/server";
import { handle, ok } from "@/lib/enrichment/http";
import { dequeue } from "@/lib/play/service";

type Ctx = { params: Promise<{ ownedGameId: string }> };

/** DELETE /api/queue/:ownedGameId — take a game back out of the queue. */
export async function DELETE(_req: NextRequest, ctx: Ctx) {
  return handle(async () => {
    await dequeue((await ctx.params).ownedGameId);
    return ok({ ok: true });
  });
}
