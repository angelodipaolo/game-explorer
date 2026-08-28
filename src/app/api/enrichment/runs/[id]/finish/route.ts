import { NextRequest } from "next/server";
import { handle, ok } from "@/lib/enrichment/http";
import { finishRun } from "@/lib/enrichment/service";

/** POST /api/enrichment/runs/:id/finish { summary? } → the run report. */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const text = await req.text();
    const body = text ? (JSON.parse(text) as { summary?: unknown }) : {};
    return ok(await finishRun((await ctx.params).id, body.summary));
  });
}
