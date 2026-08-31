import path from "node:path";
import { createImageStore } from "@/lib/media/image-store";

/**
 * Manual page scans live on disk, not in SQLite: data/manuals/<pageId>.<ext>.
 * Keyed by ManualPage id rather than manual id — a manual is many files, and
 * reordering pages must never move bytes around on disk.
 *
 * Same stance as data/maps/ and data/journal/: private, gitignored, and *not*
 * part of db:snapshot. `npm run backup` archives it alongside the database; a
 * restore without it leaves every page blank.
 */
export const MANUALS_DIR = process.env.MANUALS_DIR ?? path.resolve(process.cwd(), "data/manuals");

export const manualImages = createImageStore(MANUALS_DIR);
