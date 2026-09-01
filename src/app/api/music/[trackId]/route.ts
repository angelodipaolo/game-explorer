import { NextRequest } from "next/server";
import { handle, ok } from "@/lib/enrichment/http";
import { removeTrack, renameTrack, trackInputSchema } from "@/lib/music/service";

type Ctx = { params: Promise<{ trackId: string }> };

/**
 * PATCH /api/music/:trackId { title } — retitle a track. Owner only.
 *
 * There is no reorder counterpart here, on purpose: `MusicTrack` has no
 * `position` and the player picks a track at random, so this route only ever
 * touches `title` — see reference/music.md for the fuller reasoning.
 */
export async function PATCH(req: NextRequest, ctx: Ctx) {
  return handle(async () => ok(await renameTrack((await ctx.params).trackId, trackInputSchema.parse(await req.json()))));
}

/**
 * DELETE /api/music/:trackId — the track row and its audio file. Owner only.
 *
 * Not on the proxy's public allowlist: only `GET`/`HEAD` on the `/audio`
 * subpath is, and this file exports no `GET` at all.
 */
export async function DELETE(_req: NextRequest, ctx: Ctx) {
  return handle(async () => {
    await removeTrack((await ctx.params).trackId);
    return ok({ ok: true });
  });
}
