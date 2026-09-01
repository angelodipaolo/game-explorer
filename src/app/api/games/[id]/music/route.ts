import { NextRequest, NextResponse } from "next/server";
import { handle, ok } from "@/lib/enrichment/http";
import { addTrack, playableTracksFor, trackInputSchema } from "@/lib/music/service";

type Ctx = { params: Promise<{ id: string }> };

/**
 * GET /api/games/:id/music — the soundtrack registered for this copy.
 *
 *   { "tracks": [{ "id": "clx…", "title": "Vampire Killer" }] }
 *
 * `{ "tracks": [] }` is the answer for a game with no music, an id that does
 * not exist, and a server with no music at all. The player asks this on every
 * game page, so "no music here" has to be an ordinary, cheap, uninteresting
 * response — never a 404 the console shouts about, and never anything that
 * tells a stranger which ids are real.
 *
 * Public (`src/proxy.ts` allowlist) and read-only. It lists ids and titles and
 * nothing else: no filenames, no sizes, nothing about the disk. Tracks whose
 * audio has not been uploaded yet are left out — they are not playable, and
 * handing the player an id that would 404 helps no one.
 */
export async function GET(_req: NextRequest, ctx: Ctx) {
  return handle(async () => {
    const { id } = await ctx.params;
    return NextResponse.json({ tracks: await playableTracksFor(id) }, { headers: { "cache-control": "private, max-age=0, must-revalidate" } });
  });
}

/**
 * POST /api/games/:id/music { title } — create the track row. Owner only.
 *
 * Upload the audio next with `PUT /api/music/:trackId/audio`; the row exists
 * first so the bytes have somewhere to go, exactly like a manual page.
 */
export async function POST(req: NextRequest, ctx: Ctx) {
  return handle(async () => {
    const { id } = await ctx.params;
    return ok(await addTrack(id, trackInputSchema.parse(await req.json())), 201);
  });
}
