import { NextResponse } from "next/server";
import { handle } from "@/lib/enrichment/http";
import { prisma } from "@/lib/db";
import { loadIndex } from "@/lib/music/library";
import { tracksFor } from "@/lib/music/manifest";

type Ctx = { params: Promise<{ ownedGameId: string }> };

/**
 * GET /api/music/games/:ownedGameId — the soundtrack registered for this copy.
 *
 *   { "tracks": [{ "id": "smb3-overworld", "title": "Overworld" }] }
 *
 * `{ "tracks": [] }` is the answer for a game with no music, a game the
 * manifest does not mention, an id that does not exist, and a machine with no
 * `data/music/` at all. The player asks this on every game page, so "no music
 * here" has to be an ordinary, cheap, uninteresting response — never a 404 the
 * console shouts about, and never anything that tells a stranger which ids are
 * real.
 *
 * Public (`src/proxy.ts` allowlist), read-only, and it returns titles only:
 * no filenames, no paths, nothing about the disk.
 */
export async function GET(_req: Request, ctx: Ctx) {
  return handle(async () => {
    const { ownedGameId } = await ctx.params;
    const index = await loadIndex();
    // Nothing registered anywhere: skip the query entirely. This is the state
    // of every checkout that has never copied music in, including CI.
    if (!index.manifest.games.length) return NextResponse.json({ tracks: [] }, { headers: { "cache-control": "private, max-age=0, must-revalidate" } });

    const copy = await prisma.ownedGame.findUnique({
      where: { id: ownedGameId },
      select: { title: true, catalogGameId: true, catalogGame: { select: { name: true } } },
    });
    const tracks = copy
      ? tracksFor(index, { igdbId: copy.catalogGameId, titles: [copy.catalogGame?.name, copy.title] })
      : [];
    return NextResponse.json(
      { tracks: tracks.map((t) => ({ id: t.id, title: t.title })) },
      { headers: { "cache-control": "private, max-age=0, must-revalidate" } },
    );
  });
}
