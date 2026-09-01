import { NextResponse } from "next/server";
import { z } from "zod";
import { EnrichmentError } from "./service";

export function ok(data: unknown, status = 200) {
  return NextResponse.json(data, { status });
}

export async function handle(fn: () => Promise<Response>): Promise<Response> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof EnrichmentError) return NextResponse.json({ error: e.message, details: e.details ?? null }, { status: e.status });
    if (e instanceof z.ZodError) return NextResponse.json({ error: "invalid input", details: e.issues }, { status: 400 });
    if (e instanceof SyntaxError) return NextResponse.json({ error: "body is not valid JSON" }, { status: 400 });
    console.error(e);
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown error" }, { status: 500 });
  }
}

/**
 * Read a raw-bytes upload body (`curl -T file`, `--data-binary @file`) with the
 * two checks that keep a truncated upload from being reported as a success.
 *
 * Next buffers every request body through `proxy.ts` up to
 * `experimental.proxyClientMaxBodySize` (next.config.ts) and then — by design,
 * see its docs — **carries on with the partial body**: no error, no rejection,
 * just fewer bytes. `await req.arrayBuffer()` hands back the truncated buffer,
 * a sniffer still sees a valid header at the front, and the route writes half a
 * file and answers 200. That is how a 12 MB soundtrack became a track that
 * plays for four minutes and stops mid-frame with nothing anywhere saying so.
 *
 * So: refuse an oversize upload from its declared length *before* reading it,
 * and after reading, insist the bytes that arrived are the bytes that were
 * promised. The second check is the one that matters — it makes truncation
 * structurally impossible to present as success even if a framework default
 * moves again, whatever the cause.
 *
 * A body with no `content-length` (chunked) is read and size-checked by the
 * service as before; nothing here can verify a length that was never declared.
 */
export async function readUploadBody(req: Request, max: number, what: string): Promise<Buffer> {
  const header = req.headers.get("content-length");
  const declared = header === null ? null : Number(header);
  const known = declared !== null && Number.isFinite(declared) && declared >= 0;

  if (known && declared > max) throw new EnrichmentError(`${what} is larger than ${Math.floor(max / 1024 / 1024)} MB`, 413);

  const buf = Buffer.from(await req.arrayBuffer());
  if (!buf.length) throw new EnrichmentError(`empty body — send the ${what} bytes`, 400);
  if (known && buf.length !== declared) {
    throw new EnrichmentError(`body was truncated: ${buf.length} of ${declared} bytes arrived. Nothing was stored.`, 400);
  }
  return buf;
}
