/**
 * Pre-fill the local image cache for the whole catalog, so the shelf, flip and
 * game pages render from disk instead of images.igdb.com.
 *
 *   npm run images:warm              # fetch everything missing
 *   npm run images:warm -- --dry-run # counts and projected bytes only
 *
 * Resumable and safe to re-run: anything already on disk costs one stat and no
 * request. The cache is disposable — delete .cache/igdb-images and run again.
 *
 * images.igdb.com is a plain CDN: no Twitch token, and not subject to the
 * 4 req/s limit src/lib/igdb/client.ts enforces on api.igdb.com.
 */
import "dotenv/config";
import { prisma } from "../src/lib/db";
import { cacheRoot, fetchAndStore, hasCached } from "../src/lib/images/cache";
import { isImageId, type ImageSize } from "../src/lib/images/sizes";

/** Sizes each catalog row is actually rendered at. Stubs never reach the hero or flip card. */
const FULL_COVER_SIZES: ImageSize[] = ["cover_small", "cover_big", "cover_big_2x"];
const STUB_COVER_SIZES: ImageSize[] = ["cover_small", "cover_big"];

/** Measured averages, for the --dry-run projection only. */
const AVG_BYTES: Record<ImageSize, number> = { cover_small: 4_000, cover_big: 27_000, cover_big_2x: 100_000, screenshot_med: 19_000, "1080p": 93_000 };

const CONCURRENCY = 8;
const ATTEMPTS = 3;

type Job = { size: ImageSize; imageId: string };

function screenshotIds(json: string): string[] {
  try {
    const parsed: unknown = JSON.parse(json);
    if (!Array.isArray(parsed)) return [];
    return parsed.map((s) => (s as { imageId?: unknown }).imageId).filter((id): id is string => typeof id === "string" && id.length > 0);
  } catch {
    return [];
  }
}

/**
 * A malformed image id in the catalog (bad import, hand-edited row) makes
 * `cachePath` throw an ImageRequestError. Thrown from inside a pool worker that
 * would reject the whole `Promise.all` and abort a 9,500-file run, so ids are
 * validated here, during planning, and reported in the summary instead.
 */
async function plan(): Promise<{ jobs: Job[]; invalid: string[] }> {
  const rows = await prisma.catalogGame.findMany({ select: { detail: true, coverImageId: true, screenshots: true } });
  const seen = new Set<string>();
  const jobs: Job[] = [];
  const invalid = new Set<string>();
  const add = (size: ImageSize, imageId: string) => {
    if (!isImageId(imageId)) {
      invalid.add(imageId);
      return;
    }
    const key = `${size}/${imageId}`;
    if (seen.has(key)) return;
    seen.add(key);
    jobs.push({ size, imageId });
  };
  for (const row of rows) {
    if (row.coverImageId) for (const size of row.detail === "full" ? FULL_COVER_SIZES : STUB_COVER_SIZES) add(size, row.coverImageId);
    for (const id of screenshotIds(row.screenshots)) add("screenshot_med", id);
  }
  return { jobs, invalid: [...invalid] };
}

/** Run `worker` over `jobs` with a fixed number of parallel workers. */
async function pool<T>(jobs: T[], n: number, worker: (job: T) => Promise<void>) {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, jobs.length) }, async () => {
      for (let i = next++; i < jobs.length; i = next++) await worker(jobs[i]);
    }),
  );
}

const mb = (bytes: number) => `${(bytes / 1_000_000).toFixed(1)} MB`;

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const started = Date.now();
  const { jobs, invalid } = await plan();

  const missing: Job[] = [];
  await pool(jobs, 32, async (job) => {
    if (!(await hasCached(job.size, job.imageId))) missing.push(job);
  });

  const byteEstimate = (js: Job[]) => js.reduce((n, j) => n + AVG_BYTES[j.size], 0);
  console.log(`cache root: ${cacheRoot()}`);
  console.log(`catalog needs ${jobs.length} files (~${mb(byteEstimate(jobs))}); ${jobs.length - missing.length} already cached, ${missing.length} missing (~${mb(byteEstimate(missing))})`);
  if (invalid.length) {
    console.log(`  skipped ${invalid.length} malformed image id${invalid.length === 1 ? "" : "s"}: ${invalid.slice(0, 10).map((id) => JSON.stringify(id)).join(", ")}${invalid.length > 10 ? ", …" : ""}`);
  }

  if (dryRun) {
    const bySize = new Map<ImageSize, number>();
    for (const j of jobs) bySize.set(j.size, (bySize.get(j.size) ?? 0) + 1);
    for (const [size, count] of [...bySize].sort()) console.log(`  ${size}: ${count} (~${mb(count * AVG_BYTES[size])})`);
    console.log("dry run — nothing fetched");
    return;
  }

  let fetched = 0;
  let failed = 0;
  let bytes = 0;
  const failures: string[] = [];

  await pool(missing, CONCURRENCY, async (job) => {
    const res = await fetchAndStore(job.size, job.imageId, { attempts: ATTEMPTS, timeoutMs: 15_000 });
    if (res.kind === "ok") {
      fetched++;
      bytes += res.buf.length;
    } else {
      // One dead image id must not abort a 9,500-file run.
      failed++;
      if (failures.length < 20) failures.push(`${job.size}/${job.imageId}: ${res.kind === "missing" ? `upstream ${res.status}` : res.error}`);
    }
    const done = fetched + failed;
    if (done % 250 === 0) console.log(`  ${done}/${missing.length} — ${mb(bytes)}`);
  });

  for (const f of failures) console.log(`  failed ${f}`);
  if (failed > failures.length) console.log(`  … and ${failed - failures.length} more failures`);
  const malformed = invalid.length ? `, ${invalid.length} malformed id${invalid.length === 1 ? "" : "s"}` : "";
  console.log(`fetched ${fetched}, skipped ${jobs.length - missing.length}, failed ${failed}${malformed}, ${mb(bytes)} in ${((Date.now() - started) / 1000).toFixed(1)}s`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
