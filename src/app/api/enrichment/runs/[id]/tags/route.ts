import { NextRequest } from "next/server";
import { handle, ok } from "@/lib/enrichment/http";
import { agentTagsSchema, writeAgentTags } from "@/lib/tags/service";

/** POST /api/enrichment/runs/:id/tags { tags: [{ ownedGameId, tag, sourceUrl, note? }] } */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const { tags } = agentTagsSchema.parse(await req.json());
    return ok(await writeAgentTags((await ctx.params).id, tags));
  });
}
