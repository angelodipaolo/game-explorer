import { NextRequest } from "next/server";
import { handle, ok } from "@/lib/enrichment/http";
import { codePatchSchema, removeCode, updateCode } from "@/lib/codes/service";

type Ctx = { params: Promise<{ id: string; codeId: string }> };

/** PATCH /api/games/:id/codes/:codeId — edit any field, or tick it verified. */
export async function PATCH(req: NextRequest, ctx: Ctx) {
  return handle(async () => {
    const { id, codeId } = await ctx.params;
    return ok(await updateCode(id, codeId, codePatchSchema.parse(await req.json())));
  });
}

/** DELETE /api/games/:id/codes/:codeId */
export async function DELETE(_req: NextRequest, ctx: Ctx) {
  return handle(async () => {
    const { id, codeId } = await ctx.params;
    await removeCode(id, codeId);
    return ok({ ok: true });
  });
}
