import { NextRequest } from "next/server";
import { handle, ok } from "@/lib/enrichment/http";
import { deleteEntry, entryPatchSchema, updateEntry } from "@/lib/journal/service";

type Ctx = { params: Promise<{ entryId: string }> };

/** PATCH /api/journal/:entryId — kind, title, body, occurredAt, sessionId. */
export async function PATCH(req: NextRequest, ctx: Ctx) {
  return handle(async () => ok(await updateEntry((await ctx.params).entryId, entryPatchSchema.parse(await req.json()))));
}

/** DELETE /api/journal/:entryId — the entry and its photo file. */
export async function DELETE(_req: NextRequest, ctx: Ctx) {
  return handle(async () => {
    await deleteEntry((await ctx.params).entryId);
    return ok({ ok: true });
  });
}
