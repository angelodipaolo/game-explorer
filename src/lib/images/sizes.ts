/**
 * The IGDB image sizes this app is allowed to cache and serve.
 *
 * IGDB serves many more (`thumb`, `720p`, `screenshot_huge`, …); this list is
 * an allowlist, not a catalogue. A size token arrives from a URL and is
 * concatenated into a filesystem path, so anything outside this list is a 400.
 */
export const IMAGE_SIZES = ["cover_small", "cover_big", "cover_big_2x", "screenshot_med", "1080p"] as const;

export type ImageSize = (typeof IMAGE_SIZES)[number];

export function isImageSize(value: string): value is ImageSize {
  return (IMAGE_SIZES as readonly string[]).includes(value);
}

/** IGDB image ids are alphanumeric (`co71yr`, `sc8h2p`). Nothing else may reach the filesystem. */
const IMAGE_ID = /^[a-z0-9_]+$/i;

export function isImageId(value: string): boolean {
  return value.length > 0 && value.length <= 64 && IMAGE_ID.test(value);
}

/**
 * The upstream CDN URL. This is the only place in the app that names
 * images.igdb.com — everything else goes through /api/img.
 *
 * Note: images.igdb.com is a plain CDN. It needs no Twitch token and is not
 * subject to the 4 req/s limit `src/lib/igdb/client.ts` enforces on
 * api.igdb.com, which is why this module lives outside the IGDB seam.
 */
export function igdbImageUrl(size: ImageSize, imageId: string): string {
  return `https://images.igdb.com/igdb/image/upload/t_${size}/${imageId}.jpg`;
}

/** The local route that serves the cached bytes. */
export function cachedImageUrl(size: ImageSize, imageId: string): string {
  return `/api/img/${size}/${imageId}`;
}
