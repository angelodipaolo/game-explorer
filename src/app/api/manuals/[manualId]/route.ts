import { NextRequest } from "next/server";
import { handle, ok } from "@/lib/enrichment/http";
import { deleteManual, manualPatchSchema, updateManual } from "@/lib/manuals/service";

type Ctx = { params: Promise<{ manualId: string }> };

/** PATCH /api/manuals/:manualId — title, sourceUrl, note, position. */
export async function PATCH(req: NextRequest, ctx: Ctx) {
  return handle(async () => ok(await updateManual((await ctx.params).manualId, manualPatchSchema.parse(await req.json()))));
}

/** DELETE /api/manuals/:manualId — the manual, its page rows and their files. */
export async function DELETE(_req: NextRequest, ctx: Ctx) {
  return handle(async () => {
    await deleteManual((await ctx.params).manualId);
    return ok({ ok: true });
  });
}
