import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { igdbImageUrl, isImageId, isImageSize, type ImageSize } from "./sizes";

/**
 * Disk cache for IGDB cover art and screenshots, keyed by (size, imageId).
 *
 * IGDB image ids are content addressed — the bytes behind an id never change —
 * so a file on disk is valid forever. The cache is disposable: delete it and
 * `npm run images:warm` (or the first page view) rebuilds it from the ids in
 * the database.
 *
 * Root is `.cache/igdb-images/<size>/<imageId>.jpg`, overridable with
 * IMAGE_CACHE_DIR. Read lazily so tests and scripts can point it elsewhere.
 */
export function cacheRoot(): string {
  return process.env.IMAGE_CACHE_DIR ?? path.resolve(process.cwd(), ".cache/igdb-images");
}

export class ImageRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

/**
 * Where (size, imageId) lands on disk. Both halves are validated here rather
 * than at the caller: they arrive from a URL and are joined into a path.
 */
export function cachePath(size: string, imageId: string): string {
  if (!isImageSize(size)) throw new ImageRequestError(`unknown image size "${size}"`, 400);
  if (!isImageId(imageId)) throw new ImageRequestError("invalid image id", 400);
  return path.join(cacheRoot(), size, `${imageId}.jpg`);
}

/**
 * The cached bytes, or null when this image has not been fetched yet.
 *
 * A zero-byte file is a miss, not a hit — same rule `hasCached` applies. Serving
 * one would hand the browser an empty 200 marked `immutable`, which it would
 * then never ask for again.
 */
export async function readCached(size: ImageSize, imageId: string): Promise<Buffer | null> {
  try {
    const buf = await fs.readFile(cachePath(size, imageId));
    return buf.length > 0 ? buf : null;
  } catch (e) {
    if (e instanceof ImageRequestError) throw e;
    return null;
  }
}

/** Is it already on disk? One stat — what the warm script checks before issuing a request. */
export async function hasCached(size: ImageSize, imageId: string): Promise<boolean> {
  try {
    const st = await fs.stat(cachePath(size, imageId));
    return st.isFile() && st.size > 0;
  } catch (e) {
    if (e instanceof ImageRequestError) throw e;
    return false;
  }
}

export type FetchResult =
  /** The bytes. `cached` is true when they came off disk rather than the CDN. */
  | { kind: "ok"; buf: Buffer; cached: boolean }
  /** Upstream says this image does not exist. Never cached, never retried. */
  | { kind: "missing"; status: number }
  /** Offline, timeout, or an upstream 5xx. The caller falls back to the CDN URL. */
  | { kind: "unavailable"; error: string };

/**
 * Write via a temp file in the same directory + rename, so a killed process
 * can never leave a truncated JPEG that is then served forever.
 */
async function store(file: string, buf: Buffer): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await fs.writeFile(tmp, buf);
    await fs.rename(tmp, file);
  } catch (e) {
    await fs.rm(tmp, { force: true }).catch(() => {});
    throw e;
  }
}

/**
 * Is this actually a JPEG? Every entry in this cache is served as image/jpeg
 * with an `immutable` cache-control, and nothing ever revalidates it — so a
 * captive portal's HTML login page or a proxy's error body returned with a 200
 * would poison the entry permanently, and `hasCached` would report it warm so
 * the warm script never retried. Cheaper and stricter than trusting a header:
 * every JPEG starts with SOI, 0xFF 0xD8.
 */
function isJpeg(buf: Buffer): boolean {
  return buf.length > 2 && buf[0] === 0xff && buf[1] === 0xd8;
}

/**
 * Fetch one image from the CDN and store it. Retries transient failures with
 * backoff; a 404 is not transient and is reported straight back so a dead id
 * is not retried 3 times on every render.
 */
export async function fetchAndStore(size: ImageSize, imageId: string, opts: { attempts?: number; timeoutMs?: number } = {}): Promise<FetchResult> {
  const file = cachePath(size, imageId);
  const attempts = opts.attempts ?? 1;
  const timeoutMs = opts.timeoutMs ?? 10_000;
  let lastError = "fetch failed";

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const res = await fetch(igdbImageUrl(size, imageId), { signal: AbortSignal.timeout(timeoutMs) });
      if (res.status === 404 || res.status === 403 || res.status === 410) return { kind: "missing", status: res.status };
      if (!res.ok) {
        lastError = `upstream ${res.status}`;
      } else {
        const buf = Buffer.from(await res.arrayBuffer());
        if (!buf.length) {
          lastError = "empty response";
        } else if (!isJpeg(buf)) {
          // Not an image: an intercepting proxy or an upstream error page. Store
          // nothing and degrade like any other failure, so it is retried later.
          lastError = `not a JPEG (content-type ${res.headers.get("content-type") ?? "unset"}, ${buf.length} bytes)`;
        } else {
          await store(file, buf);
          return { kind: "ok", buf, cached: false };
        }
      }
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e);
    }
    if (attempt < attempts) await new Promise((r) => setTimeout(r, 250 * 2 ** (attempt - 1)));
  }
  return { kind: "unavailable", error: lastError };
}

/**
 * Cached bytes if present, otherwise fetch-and-store. Used by the route and the
 * warm script. The `cached` flag on an `ok` result says which of the two it was,
 * so the caller never has to open the file a second time to find out.
 */
export async function getImage(size: ImageSize, imageId: string, opts?: { attempts?: number; timeoutMs?: number }): Promise<FetchResult> {
  const cached = await readCached(size, imageId);
  if (cached) return { kind: "ok", buf: cached, cached: true };
  return fetchAndStore(size, imageId, opts);
}
