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
  const filePath = (id: string, format: ImageInfo["format"]) => path.join(dir, `${id}.${format === "png" ? "png" : "jpg"}`);

  return {
    dir,
    path: filePath,
    async write(id, buf, info) {
      await fs.mkdir(dir, { recursive: true });
      // One image per row: drop the other format if it is re-uploaded.
      await Promise.all([fs.rm(filePath(id, "png"), { force: true }), fs.rm(filePath(id, "jpeg"), { force: true })]);
      await fs.writeFile(filePath(id, info.format), buf);
    },
    /** The stored image, or null when none has been uploaded yet. */
    async read(id) {
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
      await Promise.all([fs.rm(filePath(id, "png"), { force: true }), fs.rm(filePath(id, "jpeg"), { force: true })]);
    },
  };
}
