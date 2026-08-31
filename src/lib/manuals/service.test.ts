import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";

// The manual image store reads MANUALS_DIR at import time, so point it at a
// scratch directory before the module under test is loaded.
const dir = path.join(os.tmpdir(), `manuals-test-${process.pid}`);
process.env.MANUALS_DIR = dir;

const {
  addPage,
  createManual,
  deleteManual,
  deletePage,
  manualById,
  manualsFor,
  readPageImage,
  reorderPages,
  setPageImage,
  updateManual,
  updatePage,
  MAX_MANUALS_PER_GAME,
  MAX_PAGES_PER_MANUAL,
} = await import("./service");

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

const status = async (fn: () => Promise<unknown>) => {
  try {
    await fn();
    return 0;
  } catch (e) {
    return (e as { status: number }).status;
  }
};

const positions = async (manualId: string) => (await prisma.manualPage.findMany({ where: { manualId }, orderBy: { position: "asc" } })).map((p) => p.position);
const labels = async (manualId: string) => (await prisma.manualPage.findMany({ where: { manualId }, orderBy: { position: "asc" } })).map((p) => p.label);

let nes: string;
let snes: string;
beforeAll(async () => {
  await fs.mkdir(dir, { recursive: true });
});
afterAll(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});
beforeEach(async () => {
  await prisma.gameManual.deleteMany();
  await prisma.ownedGame.deleteMany();
  nes = (await prisma.ownedGame.create({ data: { title: "Contra", normalizedTitle: "contra", platform: "nes" } })).id;
  snes = (await prisma.ownedGame.create({ data: { title: "Contra III", normalizedTitle: "contra iii", platform: "snes" } })).id;
});

describe("manuals", () => {
  it('defaults the title to "Manual" and keeps manuals on one copy only', async () => {
    const m = await createManual(nes);
    expect(m.title).toBe("Manual");
    await createManual(snes, { title: "Poster map" });
    expect((await manualsFor(nes)).map((x) => x.title)).toEqual(["Manual"]);
    expect((await manualsFor(snes)).map((x) => x.title)).toEqual(["Poster map"]);
    expect(await status(() => createManual("nope"))).toBe(404);
  });

  it("edits, clears an explicit null, and 404s on an unknown id", async () => {
    const m = await createManual(nes, { note: "scanned from my copy", sourceUrl: "https://example.test/scan" });
    expect((await updateManual(m.id, { title: "Instruction booklet" })).note).toBe("scanned from my copy");
    expect((await updateManual(m.id, { note: null })).note).toBeNull();
    expect(await status(() => updateManual("nope", { title: "x" }))).toBe(404);
  });

  it("caps a game's manuals", async () => {
    for (let i = 0; i < MAX_MANUALS_PER_GAME; i++) await createManual(nes, { title: `Book ${i}` });
    expect(await status(() => createManual(nes))).toBe(409);
  });
});

describe("manual pages", () => {
  it("appends pages densely and reports them in reading order", async () => {
    const m = await createManual(nes);
    for (const label of ["Cover", "Story", "Controls"]) await addPage(m.id, { label });
    expect(await positions(m.id)).toEqual([0, 1, 2]);
    expect((await manualById(m.id))!.pages.map((p) => p.label)).toEqual(["Cover", "Story", "Controls"]);
  });

  it("inserts at a position, shifting the rest down, and clamps past the end", async () => {
    const m = await createManual(nes);
    for (const label of ["Cover", "Controls"]) await addPage(m.id, { label });
    const inserted = await addPage(m.id, { label: "Story", position: 1 });
    expect(inserted.position).toBe(1);
    expect(await labels(m.id)).toEqual(["Cover", "Story", "Controls"]);
    expect(await positions(m.id)).toEqual([0, 1, 2]);
    // Past the end appends rather than leaving a hole.
    expect((await addPage(m.id, { label: "Back", position: 99 })).position).toBe(3);
    expect(await labels(m.id)).toEqual(["Cover", "Story", "Controls", "Back"]);
  });

  it("renumbers densely when a page in the middle is deleted", async () => {
    const m = await createManual(nes);
    const pages = [];
    for (const label of ["Cover", "Story", "Controls", "Enemies"]) pages.push(await addPage(m.id, { label }));
    await deletePage(pages[1].id);
    expect(await labels(m.id)).toEqual(["Cover", "Controls", "Enemies"]);
    expect(await positions(m.id)).toEqual([0, 1, 2]);
    expect(await status(() => deletePage("nope"))).toBe(404);
  });

  it("reorders by permutation and refuses anything else", async () => {
    const m = await createManual(nes);
    const pages = [];
    for (const label of ["A", "B", "C"]) pages.push(await addPage(m.id, { label }));
    const [a, b, c] = pages.map((p) => p.id);

    const after = await reorderPages(m.id, [c, a, b]);
    expect(after.map((p) => p.position)).toEqual([0, 1, 2]);
    expect(await labels(m.id)).toEqual(["C", "A", "B"]);

    // A partial list, a duplicate, and a page from another manual all fail.
    expect(await status(() => reorderPages(m.id, [c, a]))).toBe(400);
    expect(await status(() => reorderPages(m.id, [c, a, a]))).toBe(400);
    const otherManual = await createManual(snes);
    const stranger = await addPage(otherManual.id, { label: "elsewhere" });
    expect(await status(() => reorderPages(m.id, [c, a, stranger.id]))).toBe(400);
    expect(await status(() => reorderPages("nope", []))).toBe(404);
    // Nothing moved.
    expect(await labels(m.id)).toEqual(["C", "A", "B"]);
  });

  it("caps a manual's pages", async () => {
    const m = await createManual(nes);
    await prisma.manualPage.createMany({ data: Array.from({ length: MAX_PAGES_PER_MANUAL }, (_, i) => ({ manualId: m.id, position: i, updatedAt: new Date() })) });
    expect(await status(() => addPage(m.id))).toBe(409);
    expect(await status(() => addPage("nope"))).toBe(404);
  });

  it("labels a page and cascades pages away with the game", async () => {
    const m = await createManual(nes);
    const p = await addPage(m.id);
    expect((await updatePage(p.id, { label: "Enemy list" })).label).toBe("Enemy list");
    expect((await updatePage(p.id, { label: null })).label).toBeNull();
    expect(await status(() => updatePage("nope", { label: "x" }))).toBe(404);
    await prisma.ownedGame.delete({ where: { id: nes } });
    expect(await prisma.gameManual.count()).toBe(0);
    expect(await prisma.manualPage.count()).toBe(0);
  });
});

describe("manual page scans", () => {
  it("stores bytes, records the pixel size, and removes the file with the page", async () => {
    const m = await createManual(nes);
    const p = await addPage(m.id, { label: "Cover" });
    expect([p.width, p.height]).toEqual([0, 0]);

    const bytes = png(1240, 1754);
    const saved = await setPageImage(p.id, bytes);
    expect([saved.width, saved.height]).toEqual([1240, 1754]);
    const got = await readPageImage(p.id);
    expect(got!.contentType).toBe("image/png");
    expect(got!.buf.equals(bytes)).toBe(true);
    expect(await fs.readdir(dir)).toContain(`${p.id}.png`);

    await deletePage(p.id);
    expect(await readPageImage(p.id)).toBeNull();
    expect(await fs.readdir(dir)).not.toContain(`${p.id}.png`);
  });

  it("deletes every page file when the manual goes", async () => {
    const m = await createManual(nes);
    const a = await addPage(m.id);
    const b = await addPage(m.id);
    await setPageImage(a.id, png(10, 10));
    await setPageImage(b.id, png(10, 10));
    expect(await fs.readdir(dir)).toEqual(expect.arrayContaining([`${a.id}.png`, `${b.id}.png`]));

    await deleteManual(m.id);
    expect(await prisma.manualPage.count({ where: { manualId: m.id } })).toBe(0);
    const left = await fs.readdir(dir);
    expect(left).not.toContain(`${a.id}.png`);
    expect(left).not.toContain(`${b.id}.png`);
    expect(await status(() => deleteManual("nope"))).toBe(404);
  });

  it("rejects a non-image body and an unknown page", async () => {
    const m = await createManual(nes);
    const p = await addPage(m.id);
    expect(await status(() => setPageImage(p.id, Buffer.from("GIF89a nope")))).toBe(415);
    expect(await status(() => setPageImage("nope", png(2, 2)))).toBe(404);
  });
});
