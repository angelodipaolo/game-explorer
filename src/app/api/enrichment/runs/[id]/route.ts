import { NextRequest } from "next/server";
import { handle, ok } from "@/lib/enrichment/http";
import { runReport } from "@/lib/enrichment/service";

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => ok(await runReport((await ctx.params).id)));
}
