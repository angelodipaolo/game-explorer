import { createReadStream } from "node:fs";
import { Readable } from "node:stream";
import { NextRequest, NextResponse } from "next/server";
import { EnrichmentError } from "@/lib/enrichment/service";
import { handle, ok } from "@/lib/enrichment/http";
import { parseRange } from "@/lib/music/audio";
import { findTrackFile, setTrackAudio } from "@/lib/music/service";

type Ctx = { params: Promise<{ trackId: string }> };

/** The file, or the slice of it a `Range` asked for, as a web stream — never buffered whole. */
function fileStream(path: string, start?: number, end?: number): ReadableStream<Uint8Array> {
  const node = createReadStream(path, start === undefined ? undefined : { start, end });
  return Readable.toWeb(node) as unknown as ReadableStream<Uint8Array>;
}

/**
 * GET /api/music/:trackId/audio — the audio bytes of one track.
 *
 * Public, like the map, journal and manual image reads (`src/proxy.ts`), and
 * for the same reason: a game page a visitor can open is made of the bytes
 * behind routes like this one, and an `<audio src>` carries no credentials.
 *
 * The id in the URL is attacker-chosen and it is the *only* thing a caller gets
 * to say. It is not a path and cannot become one: it must be a bare row id
 * (`isSafeMediaId`), it must name a real `MusicTrack`, and the file the store
 * builds from it is re-checked against `data/music/` — through `fs.realpath`,
 * so a symlink pointing out of the directory is refused too. Anything else is a
 * flat 404, which is also the answer for a track whose audio was never
 * uploaded.
 *
 * Streamed rather than buffered: this is an unauthenticated route and an MP3 is
 * megabytes. `Range` is honoured with a 206 so scrubbing and Safari's initial
 * probe-with-a-range work; a request without one gets the whole file and
 * `Accept-Ranges: bytes`.
 */
export async function GET(req: NextRequest, ctx: Ctx) {
  return handle(async () => {
    const { trackId } = await ctx.params;
    const found = await findTrackFile(trackId);
    if (!found) throw new EnrichmentError("no such track", 404);
    const { size, path, contentType } = found.file;

    const range = parseRange(req.headers.get("range"), size);
    if (range === "unsatisfiable") {
      return new NextResponse(null, { status: 416, headers: { "content-range": `bytes */${size}`, "accept-ranges": "bytes" } });
    }

    const headers: Record<string, string> = {
      "content-type": contentType,
      "accept-ranges": "bytes",
      // Personal files on a personal server: cached by the browser that asked,
      // never by anything in between, and revalidated so replacing a track's
      // audio takes effect.
      "cache-control": "private, max-age=0, must-revalidate",
    };

    if (range) {
      const length = range.end - range.start + 1;
      return new NextResponse(fileStream(path, range.start, range.end), {
        status: 206,
        headers: { ...headers, "content-range": `bytes ${range.start}-${range.end}/${size}`, "content-length": String(length) },
      });
    }
    return new NextResponse(fileStream(path), { headers: { ...headers, "content-length": String(size) } });
  });
}

/**
 * PUT /api/music/:trackId/audio — raw MP3 bytes as the body
 * (`curl -T "01 Vampire Killer.mp3"` or `--data-binary @…`). Owner only: this
 * is a write, and only `GET`/`HEAD` on this path are exempt from auth.
 *
 * The bytes are sniffed, not trusted: a `content-type` header proves nothing
 * about what was actually sent.
 */
export async function PUT(req: NextRequest, ctx: Ctx) {
  return handle(async () => {
    const { trackId } = await ctx.params;
    const buf = Buffer.from(await req.arrayBuffer());
    if (!buf.length) throw new EnrichmentError("empty body — send the audio bytes", 400);
    return ok(await setTrackAudio(trackId, buf));
  });
}
