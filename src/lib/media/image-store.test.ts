import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createImageStore, sniffImage } from "./image-store";

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
