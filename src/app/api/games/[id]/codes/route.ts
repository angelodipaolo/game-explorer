import { NextRequest } from "next/server";
import { handle, ok } from "@/lib/enrichment/http";
import { addCode, codeInputSchema, codesFor } from "@/lib/codes/service";

type Ctx = { params: Promise<{ id: string }> };

/** GET /api/games/:id/codes — this copy's codes, grouped kind by kind. */
export async function GET(_req: NextRequest, ctx: Ctx) {
  return handle(async () => ok(await codesFor((await ctx.params).id)));
}

/** POST /api/games/:id/codes { kind, effect, code?, howTo?, sourceUrl?, note?, verified? } */
export async function POST(req: NextRequest, ctx: Ctx) {
  return handle(async () => {
    const { id } = await ctx.params;
    return ok(await addCode(id, codeInputSchema.parse(await req.json())), 201);
  });
}
