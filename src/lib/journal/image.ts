import path from "node:path";
import { createImageStore } from "@/lib/media/image-store";

/**
 * Journal photos live on disk, not in SQLite: data/journal/<entryId>.<ext>.
 * Same stance as data/maps/ — private, gitignored, and *not* part of
 * db:snapshot. `npm run backup` archives it alongside the database; a restore
 * without it leaves each photo entry showing nothing.
 */
export const JOURNAL_DIR = process.env.JOURNAL_DIR ?? path.resolve(process.cwd(), "data/journal");

export const journalImages = createImageStore(JOURNAL_DIR);
