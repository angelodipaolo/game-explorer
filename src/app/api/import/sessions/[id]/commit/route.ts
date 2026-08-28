import { NextRequest } from "next/server";
import { handle, ok } from "@/lib/import/http";
import { commitSchema } from "@/lib/import/schema";
import { commitSession } from "@/lib/import/service";

type Ctx = { params: Promise<{ id: string }> };

/** POST /api/import/sessions/:id/commit  { force?: boolean } */
export async function POST(req: NextRequest, ctx: Ctx) {
  return handle(async () => {
    const text = await req.text();
    const input = commitSchema.parse(text ? JSON.parse(text) : {});
    return ok(await commitSession((await ctx.params).id, input));
  });
}
