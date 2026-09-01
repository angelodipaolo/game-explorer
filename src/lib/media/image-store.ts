import { createFileStore, isSafeMediaId, MediaIdError, type FileStore } from "./file-store";

/**
 * On-disk image storage, shared by every feature that keeps pixels outside
 * SQLite: `data/maps/<GameMap id>.png`, `data/journal/<JournalEntry id>.jpg`
 * and `data/manuals/<ManualPage id>.jpg`. The directories are private like the
 * snapshot (see data/README.md) and are *not* part of db:snapshot — back them
 * up alongside snapshot.json, or use `npm run backup`, which archives them all.
 *
 * Extracted from src/lib/maps/image.ts when journal photos became its second
 * user. The id rules and the directory plumbing moved down again into
 * file-store.ts when music became the first non-image user; what is left here
 * is the image-shaped part — two formats, and a sniffer that reads a picture's
 * dimensions out of its header.
 */

export type ImageInfo = { format: "png" | "jpeg"; width: number; height: number };

/** The id guard and its error, under their original names — the routes catch these. */
export { isSafeMediaId as isSafeImageId, MediaIdError as ImageIdError };

/** Upload cap, bytes. A 4096² palette PNG is well under 1 MB; a phone photo is a few MB. */
export const MAX_IMAGE_BYTES = 16 * 1024 * 1024;

/** PNG first, then JPEG: the order `read` tries, unchanged from before the extraction. */
const IMAGE_FORMATS = [
  { ext: "png", contentType: "image/png" },
  { ext: "jpg", contentType: "image/jpeg" },
] as const;

const extFor = (format: ImageInfo["format"]) => (format === "png" ? "png" : "jpg");

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
  /** The underlying store, for callers that need a size without the bytes. */
  files: FileStore;
};

/**
 * One directory of images keyed by row id. The API is unchanged from before
 * file-store.ts existed — callers pass an `ImageInfo`, not an extension.
 */
export function createImageStore(dir: string): ImageStore {
  const files = createFileStore(dir, IMAGE_FORMATS);
  return {
    dir,
    files,
    path: (id, format) => files.path(id, extFor(format)),
    write: (id, buf, info) => files.write(id, buf, extFor(info.format)),
    read: (id) => files.read(id),
    delete: (id) => files.delete(id),
  };
}
