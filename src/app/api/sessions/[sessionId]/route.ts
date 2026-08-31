import { NextRequest } from "next/server";
import { handle, ok } from "@/lib/enrichment/http";
import { deleteSession, sessionPatchSchema, updateSession } from "@/lib/play/service";

type Ctx = { params: Promise<{ sessionId: string }> };

/**
 * PATCH /api/sessions/:sessionId { startedAt?, endedAt?, outcome?, note? }
 *
 * Finish (send `endedAt` and an outcome), reopen (`endedAt: null`), or just
 * correct the dates. The outcome is kept consistent with `endedAt` by the
 * service — an open run is always "playing".
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
