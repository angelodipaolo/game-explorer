import { NextRequest } from "next/server";
import { handle, ok } from "@/lib/import/http";
import { rollbackBatch } from "@/lib/import/service";

type Ctx = { params: Promise<{ id: string }> };

/** POST /api/import/batches/:id/rollback — undo an entire committed import. */
export async function POST(_req: NextRequest, ctx: Ctx) {
  return handle(async () => ok(await rollbackBatch((await ctx.params).id)));
}
