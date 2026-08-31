import path from "node:path";
import { createImageStore } from "@/lib/media/image-store";

/**
 * Map images live on disk, not in SQLite: data/maps/<mapId>.<ext>. The
 * directory is private like the snapshot (see data/README.md) and is *not*
 * part of db:snapshot — back it up alongside snapshot.json.
 *
 * The mechanics live in src/lib/media/image-store.ts; journal photos are the
 * same code over a different directory. The exported names here are unchanged
 * so no map code had to move.
 */
export const MAPS_DIR = process.env.MAPS_DIR ?? path.resolve(process.cwd(), "data/maps");

const store = createImageStore(MAPS_DIR);

export const imagePath = store.path;
export const writeImage = store.write;
export const readImage = store.read;
export const deleteImage = store.delete;

export { sniffImage, type ImageInfo } from "@/lib/media/image-store";
