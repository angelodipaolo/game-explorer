import { NextRequest } from "next/server";
import { handle, ok } from "@/lib/enrichment/http";
import { addBookmark, bookmarkInputSchema, bookmarksFor } from "@/lib/bookmarks/service";

type Ctx = { params: Promise<{ id: string }> };

/** GET /api/games/:id/bookmarks — this copy's links, grouped kind by kind. */
export async function GET(_req: NextRequest, ctx: Ctx) {
  return handle(async () => ok(await bookmarksFor((await ctx.params).id)));
}

/** POST /api/games/:id/bookmarks { kind, url, title, why, note? } */
export async function POST(req: NextRequest, ctx: Ctx) {
  return handle(async () => {
    const { id } = await ctx.params;
    return ok(await addBookmark(id, bookmarkInputSchema.parse(await req.json())), 201);
  });
}
