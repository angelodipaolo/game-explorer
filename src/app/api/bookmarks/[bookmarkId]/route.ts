import { NextRequest } from "next/server";
import { handle, ok } from "@/lib/enrichment/http";
import { bookmarkPatchSchema, removeBookmark, updateBookmark } from "@/lib/bookmarks/service";

type Ctx = { params: Promise<{ bookmarkId: string }> };

/** PATCH /api/bookmarks/:bookmarkId — kind, url, title, why, note, position. */
export async function PATCH(req: NextRequest, ctx: Ctx) {
  return handle(async () => ok(await updateBookmark((await ctx.params).bookmarkId, bookmarkPatchSchema.parse(await req.json()))));
}

/** DELETE /api/bookmarks/:bookmarkId */
export async function DELETE(_req: NextRequest, ctx: Ctx) {
  return handle(async () => {
    await removeBookmark((await ctx.params).bookmarkId);
    return ok({ ok: true });
  });
}
