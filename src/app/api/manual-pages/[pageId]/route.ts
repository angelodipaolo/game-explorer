import { NextRequest } from "next/server";
import { handle, ok } from "@/lib/enrichment/http";
import { deletePage, pagePatchSchema, updatePage } from "@/lib/manuals/service";

type Ctx = { params: Promise<{ pageId: string }> };

/** PATCH /api/manual-pages/:pageId { label } */
export async function PATCH(req: NextRequest, ctx: Ctx) {
  return handle(async () => ok(await updatePage((await ctx.params).pageId, pagePatchSchema.parse(await req.json()))));
}

/** DELETE /api/manual-pages/:pageId — the page and its file; the rest renumber. */
export async function DELETE(_req: NextRequest, ctx: Ctx) {
  return handle(async () => ok(await deletePage((await ctx.params).pageId)));
}
