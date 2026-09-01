import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs/promises";
import { EnrichmentError } from "@/lib/enrichment/service";
import { handle } from "@/lib/enrichment/http";
import { TRACK_CONTENT_TYPE, findTrack, parseRange, readTrackBytes } from "@/lib/music/library";

type Ctx = { params: Promise<{ trackId: string }> };

/**
 * GET /api/music/tracks/:trackId — the audio bytes of one registered track.
 *
 * Public, like the map, journal and manual image reads (`src/proxy.ts`), and
 * for the same reason: a game page a visitor can open is made of the bytes
 * behind routes like this one, and an `<audio src>` carries no credentials.
 *
 * The id in the URL is attacker-chosen, and it is the *only* thing a caller
 * gets to say. It is not a path and cannot become one: it must match the
 * track-id allowlist, it must already be in `data/music/index.json`, and the
 * file the manifest names is resolved and re-checked against the directory
 * (symlinks included) before a byte is read. Anything else is a flat 404 —
 * which is also the answer for an id that exists but whose MP3 was never
 * copied across.
 *
 * `Range` is honoured with a 206 so scrubbing and Safari's initial
 * probe-with-a-range work; a request without one gets the whole file and
 * `Accept-Ranges: bytes`.
 */
export async function GET(req: NextRequest, ctx: Ctx) {
  return handle(async () => {
    const { trackId } = await ctx.params;
    const found = await findTrack(trackId);
    if (!found) throw new EnrichmentError("no such track", 404);

    const range = parseRange(req.headers.get("range"), found.size);
    if (range === "unsatisfiable") {
      return new NextResponse(null, { status: 416, headers: { "content-range": `bytes */${found.size}`, "accept-ranges": "bytes" } });
    }

    const headers: Record<string, string> = {
      "content-type": TRACK_CONTENT_TYPE,
      "accept-ranges": "bytes",
      // Personal files on a personal server: cached by the browser that asked,
      // never by anything in between, and revalidated so replacing an MP3 in
      // place takes effect.
      "cache-control": "private, max-age=0, must-revalidate",
    };

    if (range) {
      const buf = await readTrackBytes(found.path, range.start, range.end);
      return new NextResponse(new Uint8Array(buf), {
        status: 206,
        headers: { ...headers, "content-range": `bytes ${range.start}-${range.start + buf.length - 1}/${found.size}`, "content-length": String(buf.length) },
      });
    }

    const buf = await fs.readFile(found.path);
    return new NextResponse(new Uint8Array(buf), { headers: { ...headers, "content-length": String(buf.length) } });
  });
}
