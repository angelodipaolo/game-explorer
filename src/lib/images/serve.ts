import { ImageRequestError, getImage } from "./cache";
import { igdbImageUrl, isImageId, isImageSize } from "./sizes";

/** A cached image id never changes its bytes, so it can be cached hard by the browser. */
const IMMUTABLE = "public, max-age=31536000, immutable";

/**
 * Short on purpose: a browser is waiting on this request. A hanging uplink
 * should fall through to the 307 CDN redirect in a few seconds rather than hold
 * the connection open. The warm script passes its own, longer timeout.
 */
const ROUTE_TIMEOUT_MS = 3_000;

/**
 * The whole of GET /api/img/:size/:imageId, as a plain fetch handler so it can
 * be unit tested without a running server.
 *
 * Hit  → the file, cached hard.
 * Miss → fetch, store, serve.
 * 404  → passed through, never cached.
 * Anything else (offline, timeout, upstream 5xx) → 307 to the real CDN URL, so
 * the browser degrades exactly the way it did before this cache existed.
 */
export async function serveImage(size: string, imageId: string): Promise<Response> {
  if (!isImageSize(size) || !isImageId(imageId)) {
    return json({ error: !isImageSize(size) ? `unknown image size "${size}"` : "invalid image id" }, 400);
  }
  try {
    const result = await getImage(size, imageId, { timeoutMs: ROUTE_TIMEOUT_MS });
    if (result.kind === "ok") return jpeg(result.buf, result.cached ? "hit" : "miss");
    if (result.kind === "missing") return json({ error: "no such image" }, 404);

    // Offline or IGDB down: let the browser try the CDN itself.
    return new Response(null, { status: 307, headers: { location: igdbImageUrl(size, imageId), "cache-control": "no-store", "x-image-cache": "upstream" } });
  } catch (e) {
    if (e instanceof ImageRequestError) return json({ error: e.message }, e.status);
    throw e;
  }
}

function jpeg(buf: Buffer, state: "hit" | "miss") {
  return new Response(new Uint8Array(buf), {
    status: 200,
    headers: { "content-type": "image/jpeg", "content-length": String(buf.length), "cache-control": IMMUTABLE, "x-image-cache": state },
  });
}

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
}
