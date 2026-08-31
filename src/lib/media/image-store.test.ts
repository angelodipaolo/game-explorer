import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ImageIdError, createImageStore, isSafeImageId, sniffImage } from "./image-store";

/** A PNG header: signature + IHDR is all sniffImage reads. */
const png = (w: number, h: number) => {
  const b = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0);
  b.writeUInt32BE(13, 8);
  b.write("IHDR", 12);
  b.writeUInt32BE(w, 16);
  b.writeUInt32BE(h, 20);
  return b;
};

/** A JPEG with one skipped APP0 segment before the SOF0 that carries the size. */
const jpeg = (w: number, h: number) => {
  const app0 = Buffer.concat([Buffer.from([0xff, 0xe0]), Buffer.alloc(2), Buffer.alloc(14)]);
  app0.writeUInt16BE(16, 2);
  const sof = Buffer.alloc(12);
  sof.writeUInt8(0xff, 0);
  sof.writeUInt8(0xc0, 1);
  sof.writeUInt16BE(10, 2);
  sof.writeUInt8(8, 4);
  sof.writeUInt16BE(h, 5);
  sof.writeUInt16BE(w, 7);
  return Buffer.concat([Buffer.from([0xff, 0xd8]), app0, sof, Buffer.alloc(16)]);
};

let dir: string;
beforeAll(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "image-store-test-"));
});
afterAll(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

describe("sniffImage", () => {
  it("reads the pixel size out of a PNG header", () => {
    expect(sniffImage(png(4096, 2048))).toEqual({ format: "png", width: 4096, height: 2048 });
  });

  it("walks JPEG markers to the first SOF", () => {
    expect(sniffImage(jpeg(1920, 1080))).toEqual({ format: "jpeg", width: 1920, height: 1080 });
  });

  it("returns null for anything else", () => {
    expect(sniffImage(Buffer.from("GIF89a not an image"))).toBeNull();
    expect(sniffImage(Buffer.alloc(0))).toBeNull();
  });
});

describe("createImageStore", () => {
  it("round-trips bytes and reports the right content type", async () => {
    const store = createImageStore(path.join(dir, "one"));
    expect(await store.read("a")).toBeNull();
    const bytes = png(2, 3);
    await store.write("a", bytes, sniffImage(bytes)!);
    const got = await store.read("a");
    expect(got!.contentType).toBe("image/png");
    expect(got!.buf.equals(bytes)).toBe(true);
    await store.delete("a");
    expect(await store.read("a")).toBeNull();
  });

  it("replaces the other format instead of leaving two files behind", async () => {
    const store = createImageStore(path.join(dir, "swap"));
    await store.write("a", png(2, 3), { format: "png", width: 2, height: 3 });
    await store.write("a", jpeg(9, 9), { format: "jpeg", width: 9, height: 9 });
    expect(await fs.readdir(path.join(dir, "swap"))).toEqual(["a.jpg"]);
    expect((await store.read("a"))!.contentType).toBe("image/jpeg");
  });

  /**
   * The ids that made `/api/maps/:id/image` an unauthenticated read of any file
   * on the mini: the route is public, `path.join(dir, id + ext)` resolves `..`
   * and `/` happily, and `%2F` in a URL segment arrives here decoded. Every
   * store entry point must refuse them — the routes' own check is a second
   * line, not the fence.
   */
  const TRAVERSAL = [
    "../x",
    "../../etc/hosts",
    "sub/dir",
    "/etc/hosts",
    "..\\windows",
    "a\\b",
    "..",
    ".",
    "a.b",
    "a.png",
    "",
    "with space",
    "nul\u0000byte",
    "x".repeat(129),
  ];

  it("refuses a traversal id at every entry point rather than touching the disk", async () => {
    const store = createImageStore(path.join(dir, "guarded"));
    const bytes = png(2, 2);
    for (const id of TRAVERSAL) {
      expect(isSafeImageId(id), JSON.stringify(id)).toBe(false);
      expect(() => store.path(id, "png"), JSON.stringify(id)).toThrow(ImageIdError);
      await expect(store.read(id), JSON.stringify(id)).rejects.toThrow(ImageIdError);
      await expect(store.write(id, bytes, { format: "png", width: 2, height: 2 }), JSON.stringify(id)).rejects.toThrow(ImageIdError);
      await expect(store.delete(id), JSON.stringify(id)).rejects.toThrow(ImageIdError);
    }
    // Nothing was created, and nothing outside the directory was reached.
    expect(await fs.readdir(path.join(dir, "guarded")).catch(() => [])).toEqual([]);
  });

  it("cannot read a file outside its own directory", async () => {
    const store = createImageStore(path.join(dir, "contained"));
    const outside = path.join(dir, "secret.png");
    await fs.writeFile(outside, png(1, 1));
    // `../secret` + ".png" is exactly the file next door.
    await expect(store.read("../secret")).rejects.toThrow(ImageIdError);
  });

  it("guards the three stores the public image routes read", async () => {
    // maps, journal and manuals are all this one factory, so the check they
    // inherit is the check above — asserted here so nobody swaps one of them
    // for a hand-rolled path and quietly loses it.
    const [{ readImage }, { journalImages }, { manualImages }] = await Promise.all([import("@/lib/maps/image"), import("@/lib/journal/image"), import("@/lib/manuals/image")]);
    await expect(readImage("../../etc/hosts")).rejects.toThrow(ImageIdError);
    await expect(journalImages.read("../../etc/hosts")).rejects.toThrow(ImageIdError);
    await expect(manualImages.read("../../etc/hosts")).rejects.toThrow(ImageIdError);
  });

  it("accepts the cuid-shaped ids these tables actually use", () => {
    for (const id of ["cm3xk2p9q0000abcd1234efgh", "a", "same-id", "under_score", "0123456789", "MixedCase"]) {
      expect(isSafeImageId(id), id).toBe(true);
    }
  });

  it("keeps two stores over different directories from colliding on the same id", async () => {
    const maps = createImageStore(path.join(dir, "maps"));
    const journal = createImageStore(path.join(dir, "journal"));
    await maps.write("same-id", png(10, 10), { format: "png", width: 10, height: 10 });
    await journal.write("same-id", png(20, 20), { format: "png", width: 20, height: 20 });

    expect(sniffImage((await maps.read("same-id"))!.buf)).toMatchObject({ width: 10 });
    expect(sniffImage((await journal.read("same-id"))!.buf)).toMatchObject({ width: 20 });

    // Deleting from one store leaves the other alone.
    await maps.delete("same-id");
    expect(await maps.read("same-id")).toBeNull();
    expect(await journal.read("same-id")).not.toBeNull();
  });
});
