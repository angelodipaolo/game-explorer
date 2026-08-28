import { NextRequest } from "next/server";
import { handle, ok } from "@/lib/import/http";
import { decideRowSchema } from "@/lib/import/schema";
import { decideRow } from "@/lib/import/service";

type Ctx = { params: Promise<{ id: string; rowId: string }> };

/** PATCH /api/import/sessions/:id/rows/:rowId  { decision, igdbId?, title?, platform?, quantity?, decidedBy? } */
export async function PATCH(req: NextRequest, ctx: Ctx) {
  return handle(async () => {
    const { id, rowId } = await ctx.params;
    const input = decideRowSchema.parse(await req.json());
    return ok(await decideRow(id, rowId, input));
  });
}
