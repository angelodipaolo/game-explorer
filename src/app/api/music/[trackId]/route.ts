import { NextRequest } from "next/server";
import { handle, ok } from "@/lib/enrichment/http";
import { removeTrack } from "@/lib/music/service";

type Ctx = { params: Promise<{ trackId: string }> };

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
