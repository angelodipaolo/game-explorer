import fs from "node:fs/promises";
import path from "node:path";

/**
 * On-disk image storage, shared by every feature that keeps pixels outside
 * SQLite: `data/maps/<GameMap id>.png` and `data/journal/<JournalEntry id>.jpg`
 * today. The directories are private like the snapshot (see data/README.md)
 * and are *not* part of db:snapshot — back them up alongside snapshot.json,
 * or use `npm run backup`, which archives both.
 *
 * Extracted from src/lib/maps/image.ts when journal photos became its second
 * user. Everything here except the directory was already generic.
 */

export type ImageInfo = { format: "png" | "jpeg"; width: number; height: number };

/**
 * A row id that was refused before it ever reached the filesystem. Typed so the
 * routes can answer `404` — an id that cannot name a file cannot name a stored
 * image either — instead of letting it fall through to `handle()`'s 500.
 */
export class ImageIdError extends Error {
  constructor(id: string) {
    super(`invalid image id ${JSON.stringify(id.slice(0, 64))}`);
    this.name = "ImageIdError";
  }
}

/**
 * The one rule that keeps `data/maps`, `data/journal` and `data/manuals` shut.
 *
 * Every id here arrives from a URL segment (`/api/maps/:mapId/image`), and
 * `path.join(dir, id + ext)` happily resolves `..` and `/` — `%2F..%2Fetc%2F`
 * decoded is a read of any file the server process can open. So the id is
 * matched against an allowlist rather than scanned for bad shapes: these are
 * Prisma `cuid()` values (`@default(cuid())` on every row that owns an image),
 * so letters, digits, `-` and `_` cover them with room to spare, and **no**
 * `.`, `/`, `\`, NUL, or anything else that can mean a directory.
 *
 * The same rigor as `isImageId` in src/lib/images/sizes.ts, for the same
 * reason: a URL segment is about to become a path.
 */
const SAFE_ID = /^[A-Za-z0-9_-]+$/;

export function isSafeImageId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 128 && SAFE_ID.test(value);
}

/** Every entry point runs through this before touching `dir`. */
function requireSafeId(id: string): string {
  if (!isSafeImageId(id)) throw new ImageIdError(String(id));
  return id;
}

/** Upload cap, bytes. A 4096² palette PNG is well under 1 MB; a phone photo is a few MB. */
export const MAX_IMAGE_BYTES = 16 * 1024 * 1024;

/**
 * Read the pixel size out of the file header, so an upload records its own
 * dimensions and the viewer never has to wait for the image to know how big
 * the world is. PNG: IHDR is always the first chunk. JPEG: walk the markers to
 * the first SOF.
 */
export function sniffImage(buf: Buffer): ImageInfo | null {
  if (buf.length >= 24 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return { format: "png", width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  }
  if (buf.length >= 4 && buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2;
    while (i + 9 < buf.length) {
      if (buf[i] !== 0xff) return null;
      const marker = buf[i + 1];
      if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
        i += 2;
        continue;
      }
      const len = buf.readUInt16BE(i + 2);
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { format: "jpeg", width: buf.readUInt16BE(i + 7), height: buf.readUInt16BE(i + 5) };
      }
      i += 2 + len;
    }
  }
  return null;
}

export type ImageStore = {
  dir: string;
  path: (id: string, format: ImageInfo["format"]) => string;
  write: (id: string, buf: Buffer, info: ImageInfo) => Promise<void>;
  read: (id: string) => Promise<{ buf: Buffer; contentType: string } | null>;
  delete: (id: string) => Promise<void>;
};

/**
 * One directory of images keyed by row id. Two stores over two directories
 * never collide even when the ids match, which is the whole reason this is a
 * closure over `dir` rather than a module-level constant.
 */
export function createImageStore(dir: string): ImageStore {
  // `requireSafeId` is on the *inside* of the one function that builds a path,
  // so no store method can reach the disk with an id that skipped the check.
  const filePath = (id: string, format: ImageInfo["format"]) => path.join(dir, `${requireSafeId(id)}.${format === "png" ? "png" : "jpg"}`);

  return {
    dir,
    path: filePath,
    async write(id, buf, info) {
      requireSafeId(id);
      await fs.mkdir(dir, { recursive: true });
      // One image per row: drop the other format if it is re-uploaded.
      await Promise.all([fs.rm(filePath(id, "png"), { force: true }), fs.rm(filePath(id, "jpeg"), { force: true })]);
      await fs.writeFile(filePath(id, info.format), buf);
    },
    /** The stored image, or null when none has been uploaded yet. Throws `ImageIdError` on an id that is not a bare row id. */
    async read(id) {
      requireSafeId(id);
      for (const [format, type] of [
        ["png", "image/png"],
        ["jpeg", "image/jpeg"],
      ] as const) {
        try {
          return { buf: await fs.readFile(filePath(id, format)), contentType: type };
        } catch {}
      }
      return null;
    },
    async delete(id) {
      requireSafeId(id);
      await Promise.all([fs.rm(filePath(id, "png"), { force: true }), fs.rm(filePath(id, "jpeg"), { force: true })]);
    },
  };
}
