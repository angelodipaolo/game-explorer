import { NextRequest } from "next/server";
import { handle, ok } from "@/lib/import/http";
import { discardSession, getSession } from "@/lib/import/service";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, ctx: Ctx) {
  return handle(async () => ok(await getSession((await ctx.params).id)));
}

export async function DELETE(_req: NextRequest, ctx: Ctx) {
  return handle(async () => ok(await discardSession((await ctx.params).id)));
}
