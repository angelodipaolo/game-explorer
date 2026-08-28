import { NextRequest } from "next/server";
import { handle, ok } from "@/lib/enrichment/http";
import { writeAgentFacts, writeFactsSchema } from "@/lib/enrichment/service";

/** POST /api/enrichment/runs/:id/facts { facts: [{ ownedGameId, field, value, sourceUrl, note? }] } */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const { facts } = writeFactsSchema.parse(await req.json());
    return ok(await writeAgentFacts((await ctx.params).id, facts));
  });
}
