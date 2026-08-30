import fs from "node:fs/promises";
import path from "node:path";

/**
 * Map images live on disk, not in SQLite: data/maps/<mapId>.<ext>. The
 * directory is private like the snapshot (see data/README.md) and is *not*
 * part of db:snapshot — back it up alongside snapshot.json.
 */
export const MAPS_DIR = process.env.MAPS_DIR ?? path.resolve(process.cwd(), "data/maps");

export type ImageInfo = { format: "png" | "jpeg"; width: number; height: number };

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
      if ((marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc)) {
        return { format: "jpeg", width: buf.readUInt16BE(i + 7), height: buf.readUInt16BE(i + 5) };
      }
      i += 2 + len;
    }
  }
  return null;
}

export function imagePath(mapId: string, format: ImageInfo["format"]) {
  return path.join(MAPS_DIR, `${mapId}.${format === "png" ? "png" : "jpg"}`);
}

export async function writeImage(mapId: string, buf: Buffer, info: ImageInfo) {
  await fs.mkdir(MAPS_DIR, { recursive: true });
  // One image per map: drop the other format if the map is re-uploaded.
  await Promise.all([fs.rm(imagePath(mapId, "png"), { force: true }), fs.rm(imagePath(mapId, "jpeg"), { force: true })]);
  await fs.writeFile(imagePath(mapId, info.format), buf);
}

/** The stored image, or null when none has been uploaded yet. */
export async function readImage(mapId: string): Promise<{ buf: Buffer; contentType: string } | null> {
  for (const [format, type] of [
    ["png", "image/png"],
    ["jpeg", "image/jpeg"],
  ] as const) {
    try {
      return { buf: await fs.readFile(imagePath(mapId, format)), contentType: type };
    } catch {}
  }
  return null;
}

export async function deleteImage(mapId: string) {
  await Promise.all([fs.rm(imagePath(mapId, "png"), { force: true }), fs.rm(imagePath(mapId, "jpeg"), { force: true })]);
}
