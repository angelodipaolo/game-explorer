import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cachePath, fetchAndStore, hasCached, readCached } from "./cache";
import { serveImage } from "./serve";
import { IMAGE_SIZES, isImageId, isImageSize } from "./sizes";

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);

let dir: string;
const realFetch = globalThis.fetch;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "img-cache-"));
  process.env.IMAGE_CACHE_DIR = dir;
});

afterEach(async () => {
  globalThis.fetch = realFetch;
  delete process.env.IMAGE_CACHE_DIR;
  await fs.rm(dir, { recursive: true, force: true });
});

const okFetch = () => vi.fn<(url: string | URL | Request) => Promise<Response>>(async () => new Response(new Uint8Array(JPEG), { status: 200, headers: { "content-type": "image/jpeg" } }));

describe("size and id validation", () => {
  it("allowlists sizes", () => {
    for (const s of IMAGE_SIZES) expect(isImageSize(s)).toBe(true);
    for (const s of ["cover_huge", "t_cover_big", "", "../cover_big", "720p"]) expect(isImageSize(s)).toBe(false);
  });
  it("rejects anything that is not an image id", () => {
    expect(isImageId("co71yr")).toBe(true);
    expect(isImageId("sc_8h2p")).toBe(true);
    for (const id of ["", "../../etc/passwd", "co71yr.jpg", "co/71yr", "a b", "co71yr\0", "x".repeat(65)]) expect(isImageId(id)).toBe(false);
  });
  it("cachePath stays under the cache root", () => {
    expect(cachePath("cover_big", "co71yr")).toBe(path.join(dir, "cover_big", "co71yr.jpg"));
    expect(() => cachePath("cover_big", "../../etc/passwd")).toThrow(/invalid image id/);
    expect(() => cachePath("nope", "co71yr")).toThrow(/unknown image size/);
  });
});

describe("fetch and store", () => {
  it("fetches once on a miss, then serves from disk with no network call", async () => {
    const f = okFetch();
    globalThis.fetch = f as unknown as typeof fetch;

    expect(await hasCached("cover_big", "co71yr")).toBe(false);
    const first = await serveImage("cover_big", "co71yr");
    expect(first.status).toBe(200);
    expect(first.headers.get("x-image-cache")).toBe("miss");
    expect(first.headers.get("content-type")).toBe("image/jpeg");
    expect(first.headers.get("cache-control")).toContain("immutable");
    expect(Buffer.from(await first.arrayBuffer())).toEqual(JPEG);
    expect(f).toHaveBeenCalledTimes(1);
    expect(String(f.mock.calls[0][0])).toBe("https://images.igdb.com/igdb/image/upload/t_cover_big/co71yr.jpg");

    expect(await hasCached("cover_big", "co71yr")).toBe(true);
    expect(await readCached("cover_big", "co71yr")).toEqual(JPEG);

    const second = await serveImage("cover_big", "co71yr");
    expect(second.status).toBe(200);
    expect(second.headers.get("x-image-cache")).toBe("hit");
    expect(f).toHaveBeenCalledTimes(1);
  });

  it("leaves no temp files behind", async () => {
    globalThis.fetch = okFetch() as unknown as typeof fetch;
    await serveImage("cover_small", "co71yr");
    expect(await fs.readdir(path.join(dir, "cover_small"))).toEqual(["co71yr.jpg"]);
  });

  it("passes a 404 through and does not cache it", async () => {
    const f = vi.fn(async () => new Response("not found", { status: 404 }));
    globalThis.fetch = f as unknown as typeof fetch;
    const res = await serveImage("cover_big", "nosuchid");
    expect(res.status).toBe(404);
    // A 404 must never be cached by the browser either: the id can start working
    // the moment the catalog is re-synced.
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("cache-control")).not.toContain("immutable");
    expect(await hasCached("cover_big", "nosuchid")).toBe(false);
    expect(f).toHaveBeenCalledTimes(1);
  });

  it("refuses to store a 200 that is not a JPEG", async () => {
    // A captive portal or an intercepting proxy answering with an HTML page.
    const f = vi.fn(async () => new Response("<html>sign in to the wifi</html>", { status: 200, headers: { "content-type": "text/html" } }));
    globalThis.fetch = f as unknown as typeof fetch;

    const res = await fetchAndStore("cover_big", "co71yr", { attempts: 2, timeoutMs: 50 });
    expect(res.kind).toBe("unavailable");
    expect(res.kind === "unavailable" && res.error).toMatch(/not a JPEG/);
    expect(f).toHaveBeenCalledTimes(2);

    // Nothing poisoned the cache: still cold, so it is retried rather than served forever.
    expect(await hasCached("cover_big", "co71yr")).toBe(false);
    expect(await readCached("cover_big", "co71yr")).toBeNull();
    expect(await fs.readdir(path.join(dir, "cover_big")).catch(() => [])).toEqual([]);

    // And the route degrades to the CDN rather than serving the HTML as an image.
    const served = await serveImage("cover_big", "co71yr");
    expect(served.status).toBe(307);
  });

  it("treats a zero-byte file as a miss, not an empty immutable hit", async () => {
    await fs.mkdir(path.join(dir, "cover_big"), { recursive: true });
    await fs.writeFile(path.join(dir, "cover_big", "co71yr.jpg"), "");

    expect(await hasCached("cover_big", "co71yr")).toBe(false);
    expect(await readCached("cover_big", "co71yr")).toBeNull();

    const f = okFetch();
    globalThis.fetch = f as unknown as typeof fetch;
    const res = await serveImage("cover_big", "co71yr");
    expect(res.status).toBe(200);
    expect(res.headers.get("x-image-cache")).toBe("miss");
    expect(Buffer.from(await res.arrayBuffer())).toEqual(JPEG);
    expect(f).toHaveBeenCalledTimes(1);
  });

  it("retries a transient failure and reports it as unavailable", async () => {
    const f = vi.fn(async () => {
      throw new Error("getaddrinfo ENOTFOUND images.igdb.com");
    });
    globalThis.fetch = f as unknown as typeof fetch;
    const res = await fetchAndStore("cover_big", "co71yr", { attempts: 2, timeoutMs: 50 });
    expect(res).toEqual({ kind: "unavailable", error: "getaddrinfo ENOTFOUND images.igdb.com" });
    expect(f).toHaveBeenCalledTimes(2);
  });
});

describe("serveImage", () => {
  it("400s on path traversal and unknown sizes", async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error("should not be called");
    }) as unknown as typeof fetch;
    for (const [size, id] of [
      ["cover_big", "../../etc/passwd"],
      ["cover_big", "..%2F..%2Fetc%2Fpasswd"],
      ["../../..", "co71yr"],
      ["cover_huge", "co71yr"],
      ["cover_big", ""],
    ] as const) {
      const res = await serveImage(size, id);
      expect(res.status, `${size}/${id}`).toBe(400);
      // A rejection is never cacheable — nothing about it is immutable.
      expect(res.headers.get("cache-control"), `${size}/${id}`).toBe("no-store");
      expect(res.headers.get("cache-control"), `${size}/${id}`).not.toContain("immutable");
    }
  });

  it("redirects to the CDN when the fetch fails (offline)", async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error("offline");
    }) as unknown as typeof fetch;
    const res = await serveImage("screenshot_med", "sc8h2p");
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("https://images.igdb.com/igdb/image/upload/t_screenshot_med/sc8h2p.jpg");
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("serves a warm cache while offline", async () => {
    await fs.mkdir(path.join(dir, "cover_big_2x"), { recursive: true });
    await fs.writeFile(path.join(dir, "cover_big_2x", "co71yr.jpg"), JPEG);
    globalThis.fetch = vi.fn(async () => {
      throw new Error("offline");
    }) as unknown as typeof fetch;
    const res = await serveImage("cover_big_2x", "co71yr");
    expect(res.status).toBe(200);
    expect(Buffer.from(await res.arrayBuffer())).toEqual(JPEG);
  });
});
