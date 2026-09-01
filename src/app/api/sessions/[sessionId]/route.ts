import { NextRequest } from "next/server";
import { handle, ok } from "@/lib/enrichment/http";
import { deleteSession, sessionPatchSchema, updateSession } from "@/lib/play/service";

type Ctx = { params: Promise<{ sessionId: string }> };

/**
 * PATCH /api/sessions/:sessionId { startedAt?, endedAt?, undated?, outcome?, note? }
 *
 * Finish (send `endedAt` and an outcome), reopen (`endedAt: null`), or just
 * correct the dates. This is also the only way `undated` moves in either
 * direction: `undated: true` forgets a run's dates, and `undated: false` with
 * a real `startedAt` and `endedAt` is the "I remembered when that was" edit. The outcome is kept consistent with `endedAt` by the
 * service — an open run is always "playing", and an `outcome` of `completed`
 * or `abandoned` sent without an `endedAt` that actually closes the run is a
 * `400` naming the missing field (GAMEEXPLOR-0038) rather than a `200` that
 * quietly keeps the run open and throws the outcome away.
 */
export async function PATCH(req: NextRequest, ctx: Ctx) {
  return handle(async () => ok(await updateSession((await ctx.params).sessionId, sessionPatchSchema.parse(await req.json()))));
}

/** DELETE /api/sessions/:sessionId — the run only; its journal entries survive with a null sessionId. */
export async function DELETE(_req: NextRequest, ctx: Ctx) {
  return handle(async () => {
    await deleteSession((await ctx.params).sessionId);
    return ok({ ok: true });
  });
}
