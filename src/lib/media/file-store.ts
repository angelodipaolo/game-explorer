import fs from "node:fs/promises";
import path from "node:path";

/**
 * The generic half of on-disk blob storage: one directory of files named by
 * row id, in one of a small fixed set of formats.
 *
 * Extracted from image-store.ts when music (GAMEEXPLOR-0025) became the fourth
 * user of that directory pattern and the first one that is not pixels.
 * `createImageStore` and `createAudioStore` are both thin wrappers over this;
 * nothing else should build a fifth store from scratch.
 *
 * Everything here except the format table was already generic — including the
 * two rules that matter:
 *
 * 1. **Ids are an allowlist, never a scan for bad shapes** (`isSafeMediaId`).
 * 2. **The resolved path is re-checked against the directory** before any read,
 *    which is the only way to catch a symlink — the one escape a string check
 *    cannot see.
 */

/** One storable shape: the extension on disk and what to serve it as. */
export type MediaFormat = { ext: string; contentType: string };

/**
 * A row id that was refused before it ever reached the filesystem. Typed so the
 * routes can answer `404` — an id that cannot name a file cannot name a stored
 * blob either — instead of letting it fall through to `handle()`'s 500.
 *
 * Still exported as `ImageIdError` from image-store.ts: same class, older name,
 * and the routes that catch it predate music.
 */
export class MediaIdError extends Error {
  constructor(id: string) {
    super(`invalid media id ${JSON.stringify(id.slice(0, 64))}`);
    this.name = "MediaIdError";
  }
}

/**
 * The one rule that keeps `data/maps`, `data/journal`, `data/manuals` and
 * `data/music` shut.
 *
 * Every id here arrives from a URL segment (`/api/maps/:mapId/image`,
 * `/api/music/:trackId/audio`), and `path.join(dir, id + ext)` happily resolves
 * `..` and `/` — `%2F..%2Fetc%2F` decoded is a read of any file the server
 * process can open. So the id is matched against an allowlist rather than
 * scanned for bad shapes: these are Prisma `cuid()` values (`@default(cuid())`
 * on every row that owns a file), so letters, digits, `-` and `_` cover them
 * with room to spare, and **no** `.`, `/`, `\`, NUL, or anything else that can
 * mean a directory.
 *
 * The same rigor as `isImageId` in src/lib/images/sizes.ts, for the same
 * reason: a URL segment is about to become a path.
 */
const SAFE_ID = /^[A-Za-z0-9_-]+$/;

export function isSafeMediaId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 128 && SAFE_ID.test(value);
}

/** Every entry point runs through this before touching the directory. */
export function requireSafeMediaId(id: string): string {
  if (!isSafeMediaId(id)) throw new MediaIdError(String(id));
  return id;
}

/**
 * Does `file` really live under `root`?
 *
 * Both sides go through `fs.realpath` because the answer has to be about the
 * filesystem, not about the string: a symlink at `data/music/<id>.mp3` pointing
 * at `~/.ssh/id_ed25519` passes every textual check ever written. Resolving the
 * root too means a symlinked `data/` — a perfectly ordinary way to keep blobs
 * on another disk — still works.
 *
 * Returns the *resolved* path on success, and that is the path callers then
 * read: checking one path and opening another is how a check becomes a race.
 * A path that cannot be resolved at all (the usual case: nothing uploaded yet)
 * is simply "not inside".
 */
async function resolveInside(root: string, file: string): Promise<string | null> {
  try {
    const [realRoot, realFile] = await Promise.all([fs.realpath(root), fs.realpath(file)]);
    const rel = path.relative(realRoot, realFile);
    return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel) ? realFile : null;
  } catch {
    return null;
  }
}

/**
 * A file that exists, is inside the store, and is ready to serve. `path` is the
 * fully resolved one — read *that*, not the path you built, or the containment
 * check and the open are looking at two different files.
 */
export type StoredFile = { path: string; size: number; contentType: string; ext: string };

export type FileStore = {
  dir: string;
  formats: readonly MediaFormat[];
  path: (id: string, ext: string) => string;
  /** Metadata only — the size a `Range` response needs without reading the file. */
  stat: (id: string) => Promise<StoredFile | null>;
  write: (id: string, buf: Buffer, ext: string) => Promise<void>;
  read: (id: string) => Promise<{ buf: Buffer; contentType: string } | null>;
  delete: (id: string) => Promise<void>;
};

/**
 * One directory of files keyed by row id. Two stores over two directories never
 * collide even when the ids match, which is the whole reason this is a closure
 * over `dir` rather than a module-level constant.
 */
export function createFileStore(dir: string, formats: readonly MediaFormat[]): FileStore {
  if (!formats.length) throw new Error("a file store needs at least one format");

  // `requireSafeMediaId` is on the *inside* of the one function that builds a
  // path, so no store method can reach the disk with an id that skipped it.
  const filePath = (id: string, ext: string) => path.join(dir, `${requireSafeMediaId(id)}.${ext}`);
  const contentTypeFor = (ext: string) => formats.find((f) => f.ext === ext)?.contentType ?? "application/octet-stream";

  const store: FileStore = {
    dir,
    formats,
    path: filePath,
    async stat(id) {
      requireSafeMediaId(id);
      for (const format of formats) {
        const full = filePath(id, format.ext);
        try {
          const st = await fs.stat(full);
          if (!st.isFile() || st.size === 0) continue;
          // Existence is not permission: the file has to actually be in here.
          const resolved = await resolveInside(dir, full);
          if (!resolved) {
            console.warn(`media: ${full} resolves outside ${dir} — refusing`);
            continue;
          }
          return { path: resolved, size: st.size, contentType: format.contentType, ext: format.ext };
        } catch {}
      }
      return null;
    },
    async write(id, buf, ext) {
      requireSafeMediaId(id);
      if (!formats.some((f) => f.ext === ext)) throw new Error(`unsupported format ${JSON.stringify(ext)} for ${dir}`);
      await fs.mkdir(dir, { recursive: true });
      // One file per row: drop the other formats if it is re-uploaded.
      await Promise.all(formats.filter((f) => f.ext !== ext).map((f) => fs.rm(filePath(id, f.ext), { force: true })));
      await fs.writeFile(filePath(id, ext), buf);
    },
    /** The stored bytes, or null when nothing has been uploaded yet. Throws `MediaIdError` on an id that is not a bare row id. */
    async read(id) {
      const found = await store.stat(id);
      if (!found) return null;
      try {
        return { buf: await fs.readFile(found.path), contentType: contentTypeFor(found.ext) };
      } catch {
        return null;
      }
    },
    async delete(id) {
      requireSafeMediaId(id);
      await Promise.all(formats.map((f) => fs.rm(filePath(id, f.ext), { force: true })));
    },
  };

  return store;
}

/**
 * Read `[start, end]` inclusive out of a stored file, for a small `Range`
 * response. Ranges big enough to be worth streaming go through
 * `createReadStream` in the route instead.
 */
export async function readFileRange(file: string, start: number, end: number): Promise<Buffer> {
  const length = end - start + 1;
  const handle = await fs.open(file, "r");
  try {
    const buf = Buffer.alloc(length);
    const { bytesRead } = await handle.read(buf, 0, length, start);
    return bytesRead === length ? buf : buf.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}
