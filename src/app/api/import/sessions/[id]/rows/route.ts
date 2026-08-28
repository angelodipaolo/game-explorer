import { NextRequest } from "next/server";
import { handle, ok } from "@/lib/import/http";
import { addRowsSchema } from "@/lib/import/schema";
import { addRows } from "@/lib/import/service";

type Ctx = { params: Promise<{ id: string }> };

/** POST /api/import/sessions/:id/rows  { rows: [...], defaultPlatform? } */
export async function POST(req: NextRequest, ctx: Ctx) {
  return handle(async () => {
    const body = (await req.json()) as { defaultPlatform?: string | null };
    const { rows } = addRowsSchema.parse(body);
    const created = await addRows((await ctx.params).id, rows, body.defaultPlatform ?? null);
    return ok({ rows: created }, 201);
  });
}
