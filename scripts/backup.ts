/**
 * `npm run backup` — one restorable archive of everything personal:
 * `backups/game-explorer-<ISO8601>.tar.gz`, holding a consistent copy of
 * `prisma/dev.db`, the portable `data/snapshot.json` export, and the blob
 * directories the snapshot deliberately leaves out (`data/maps/`,
 * `data/journal/`, `data/manuals/`).
 *
 * The database is copied with SQLite's `VACUUM INTO`, never `fs.copyFile`:
 * the dev server may be mid-write and a byte copy of a live WAL database is a
 * torn file. `VACUUM INTO` takes a read transaction and writes a fully
 * consistent single-file copy.
 *
 * Archiving shells out to `tar -czf` (bsdtar ships with macOS, and this app is
 * Mac-only by design) so there is no new dependency.
 *
 * Usage: `npm run backup [-- --out <dir>]` — point `--out` at an external disk
 * or an iCloud folder to keep the archive off this machine.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { prisma } from "../src/lib/db";

const ROOT = path.resolve(__dirname, "..");

/** Directories whose bytes are NOT in snapshot.json and must be archived as files. */
const BLOB_DIRS = ["maps", "journal", "manuals"] as const;

function parseArgs(argv: string[]) {
  let out = path.join(ROOT, "backups");
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--out") {
      const v = argv[i + 1];
      if (!v) throw new Error("--out needs a directory");
      out = path.resolve(process.cwd(), v);
      i++;
    }
  }
  return { out };
}

/** 2026-08-30T14-22-05Z — ISO 8601 with the colons a filesystem dislikes swapped out. */
function stamp() {
  return new Date().toISOString().replace(/\.\d+Z$/, "Z").replace(/:/g, "-");
}

/**
 * The stamp has second resolution, so two backups in the same second would
 * silently overwrite each other. Never let a backup destroy a backup.
 */
function uniqueName(dir: string, base: string) {
  if (!fs.existsSync(path.join(dir, `${base}.tar.gz`))) return base;
  for (let n = 2; ; n++) {
    const candidate = `${base}-${n}`;
    if (!fs.existsSync(path.join(dir, `${candidate}.tar.gz`))) return candidate;
  }
}

function human(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** Copy a directory tree into the staging area, skipping it silently when absent. */
function copyDirIfPresent(from: string, to: string) {
  if (!fs.existsSync(from)) return 0;
  fs.cpSync(from, to, { recursive: true });
  return fs.readdirSync(from).filter((f) => !f.startsWith(".")).length;
}

/**
 * A blob directory that is empty while rows referencing it exist means a
 * restore would come back with the rows and no pixels. Say so loudly rather
 * than writing a quietly incomplete archive.
 */
async function warnOnMissingBlobs(counts: Record<string, number>) {
  const rows = {
    maps: await prisma.gameMap.count(),
    // Only photos that actually have bytes: a row POSTed but not yet PUT is
    // not a missing file, and warning about it would train you to ignore this.
    journal: await prisma.journalEntry.count({ where: { kind: "photo", width: { gt: 0 } } }),
    // Same rule for manual pages: a page row POSTed but not yet PUT has no
    // file to miss, so only pages that recorded a pixel size count.
    manuals: await prisma.manualPage.count({ where: { width: { gt: 0 } } }),
  };
  for (const dir of BLOB_DIRS) {
    if (rows[dir] > 0 && (counts[dir] ?? 0) === 0) {
      console.warn(`WARNING: data/${dir}/ is empty but the database has ${rows[dir]} row(s) that expect files there.`);
    }
  }
}

async function main() {
  const { out } = parseArgs(process.argv.slice(2));
  const name = `game-explorer-${stamp()}`;

  // Refresh the portable JSON export first, so the archive carries both the
  // binary database and a snapshot that restores through `npm run db:restore`.
  execFileSync("npx", ["tsx", path.join(ROOT, "scripts/db-snapshot.ts")], { cwd: ROOT, stdio: "inherit" });

  const stage = fs.mkdtempSync(path.join(os.tmpdir(), "game-explorer-backup-"));
  const root = path.join(stage, name);
  try {
    fs.mkdirSync(path.join(root, "data"), { recursive: true });

    // Consistent DB copy even while `next dev` is serving. VACUUM INTO refuses
    // to overwrite, so the destination must not exist yet.
    const db = path.join(root, "dev.db");
    await prisma.$executeRawUnsafe(`VACUUM INTO '${db.replace(/'/g, "''")}'`);

    const dbBytes = fs.statSync(db).size;

    const snapshot = path.join(ROOT, "data/snapshot.json");
    if (fs.existsSync(snapshot)) fs.copyFileSync(snapshot, path.join(root, "data/snapshot.json"));

    const counts: Record<string, number> = {};
    for (const dir of BLOB_DIRS) counts[dir] = copyDirIfPresent(path.join(ROOT, "data", dir), path.join(root, "data", dir));
    await warnOnMissingBlobs(counts);

    fs.mkdirSync(out, { recursive: true });
    const finalName = uniqueName(out, name);
    if (finalName !== name) fs.renameSync(root, path.join(stage, finalName));
    const archive = path.join(out, `${finalName}.tar.gz`);
    execFileSync("tar", ["-czf", archive, "-C", stage, finalName], { stdio: "inherit" });

    console.log(`backup: ${archive} (${human(fs.statSync(archive).size)})`);
    console.log(`  dev.db ${human(dbBytes)} · ${BLOB_DIRS.map((d) => `data/${d} ${counts[d]} file(s)`).join(" · ")}`);
    console.log("  restore: see data/README.md");
  } finally {
    fs.rmSync(stage, { recursive: true, force: true });
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
