import { NextRequest } from "next/server";
import { z } from "zod";
import { handle, ok } from "@/lib/enrichment/http";
import { addManualTag, removeTag, tagSchema, tagsFor, unhideTag } from "@/lib/tags/service";

type Ctx = { params: Promise<{ id: string }> };
const body = z.object({ tag: tagSchema, note: z.string().max(300).optional(), igdb: z.boolean().optional() });

export async function GET(_req: NextRequest, ctx: Ctx) {
  return handle(async () => ok(await tagsFor((await ctx.params).id)));
}

/** PUT /api/games/:id/tags { tag, note? } — add a hand-set tag; { tag, igdb: true } un-hides an IGDB tag. */
export async function PUT(req: NextRequest, ctx: Ctx) {
  return handle(async () => {
    const { id } = await ctx.params;
    const input = body.parse(await req.json());
    if (input.igdb) {
      await unhideTag(id, input.tag);
      return ok({ ok: true });
    }
    return ok(await addManualTag(id, input.tag, input.note));
  });
}

/** DELETE /api/games/:id/tags { tag, igdb? } — remove your/agent tag, or hide an IGDB one. */
export async function DELETE(req: NextRequest, ctx: Ctx) {
  return handle(async () => {
    const { id } = await ctx.params;
    const input = body.parse(await req.json());
    await removeTag(id, input.tag, { igdb: input.igdb });
    return ok({ ok: true });
  });
}
