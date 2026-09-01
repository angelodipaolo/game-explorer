import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MediaIdError, createFileStore, isSafeMediaId, readFileRange } from "./file-store";

/**
 * The generic store under the image and audio ones. image-store.test.ts still
 * owns the full id corpus (it is the same guard); what is tested here is what
 * the extraction added: `stat`, the resolved-path containment check that
 * catches a symlink, and a store whose formats are not pixels.
 */

const FORMATS = [
  { ext: "mp3", contentType: "audio/mpeg" },
  { ext: "ogg", contentType: "audio/ogg" },
] as const;

let dir: string;
let outside: string;
beforeAll(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "file-store-test-"));
  outside = await fs.mkdtemp(path.join(os.tmpdir(), "file-store-outside-"));
});
afterAll(async () => {
  await fs.rm(dir, { recursive: true, force: true });
  await fs.rm(outside, { recursive: true, force: true });
});

describe("createFileStore", () => {
  it("round-trips bytes, reports size and content type, and deletes", async () => {
    const store = createFileStore(path.join(dir, "one"), FORMATS);
    expect(await store.stat("a")).toBeNull();
    expect(await store.read("a")).toBeNull();

    await store.write("a", Buffer.alloc(2048, 0x55), "mp3");
    expect(await store.stat("a")).toMatchObject({ size: 2048, contentType: "audio/mpeg", ext: "mp3" });
    expect((await store.read("a"))!.buf).toHaveLength(2048);

    await store.delete("a");
    expect(await store.stat("a")).toBeNull();
  });

  it("replaces the other format instead of leaving two files behind", async () => {
    const store = createFileStore(path.join(dir, "swap"), FORMATS);
    await store.write("a", Buffer.alloc(8, 1), "mp3");
    await store.write("a", Buffer.alloc(8, 2), "ogg");
    expect(await fs.readdir(path.join(dir, "swap"))).toEqual(["a.ogg"]);
    expect((await store.stat("a"))!.contentType).toBe("audio/ogg");
  });

  it("refuses to write a format the store does not have", async () => {
    const store = createFileStore(path.join(dir, "formats"), FORMATS);
    await expect(store.write("a", Buffer.alloc(4), "wav")).rejects.toThrow(/unsupported format/);
  });

  it("refuses a traversal id at every entry point", async () => {
    const store = createFileStore(path.join(dir, "guarded"), FORMATS);
    for (const id of ["../x", "../../etc/hosts", "sub/dir", "/etc/hosts", "a\\b", "..", ".", "a.mp3", "", "nul byte", "x".repeat(129)]) {
      expect(isSafeMediaId(id), JSON.stringify(id)).toBe(false);
      expect(() => store.path(id, "mp3"), JSON.stringify(id)).toThrow(MediaIdError);
      await expect(store.stat(id), JSON.stringify(id)).rejects.toThrow(MediaIdError);
      await expect(store.read(id), JSON.stringify(id)).rejects.toThrow(MediaIdError);
      await expect(store.delete(id), JSON.stringify(id)).rejects.toThrow(MediaIdError);
    }
    expect(await fs.readdir(path.join(dir, "guarded")).catch(() => [])).toEqual([]);
  });

  /**
   * The escape a string check cannot see. `<id>.mp3` is a perfectly legal name;
   * it just happens to be a symlink into somebody's private library. Only
   * resolving the path and comparing it to the resolved directory catches it,
   * and it has to happen on the read — the link can appear after the write.
   */
  it("refuses a symlink that leaves the directory, on both stat and read", async () => {
    const root = path.join(dir, "linked");
    await fs.mkdir(root, { recursive: true });
    const secret = path.join(outside, "secret.mp3");
    await fs.writeFile(secret, Buffer.alloc(64, 7));
    await fs.symlink(secret, path.join(root, "escape.mp3"));

    const store = createFileStore(root, FORMATS);
    expect(await store.stat("escape")).toBeNull();
    expect(await store.read("escape")).toBeNull();
  });

  it("still works when the directory itself is a symlink", async () => {
    // data/ on another disk is an ordinary setup; resolving both sides is what
    // keeps the containment check from breaking it.
    const real = path.join(dir, "real-blobs");
    const link = path.join(dir, "linked-blobs");
    await fs.mkdir(real, { recursive: true });
    await fs.symlink(real, link);
    const store = createFileStore(link, FORMATS);
    await store.write("a", Buffer.alloc(16, 3), "mp3");
    expect((await store.stat("a"))!.size).toBe(16);
  });

  it("treats a zero-byte file as nothing stored", async () => {
    const root = path.join(dir, "empty");
    await fs.mkdir(root, { recursive: true });
    await fs.writeFile(path.join(root, "a.mp3"), Buffer.alloc(0));
    expect(await createFileStore(root, FORMATS).stat("a")).toBeNull();
  });

  it("keeps two stores over different directories from colliding on the same id", async () => {
    const one = createFileStore(path.join(dir, "s1"), FORMATS);
    const two = createFileStore(path.join(dir, "s2"), FORMATS);
    await one.write("same-id", Buffer.alloc(10, 1), "mp3");
    await two.write("same-id", Buffer.alloc(20, 2), "mp3");
    expect((await one.stat("same-id"))!.size).toBe(10);
    await one.delete("same-id");
    expect(await two.stat("same-id")).not.toBeNull();
  });
});

describe("readFileRange", () => {
  it("reads an inclusive byte range and clamps past the end", async () => {
    const file = path.join(dir, "range.bin");
    await fs.writeFile(file, Buffer.from("0123456789"));
    expect((await readFileRange(file, 0, 3)).toString()).toBe("0123");
    expect((await readFileRange(file, 8, 20)).toString()).toBe("89");
  });
});
