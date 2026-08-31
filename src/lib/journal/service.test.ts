import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { logPastSession, startSession } from "@/lib/play/service";

// The journal image store reads JOURNAL_DIR at import time, so point it at a
// scratch directory before the module under test is loaded.
const dir = path.join(os.tmpdir(), `journal-test-${process.pid}`);
process.env.JOURNAL_DIR = dir;

const { addEntry, deleteEntry, entriesFor, entryInputSchema, readEntryImage, setEntryImage, updateEntry, MAX_ENTRIES_PER_GAME } = await import("./service");

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

const at = (s: string) => new Date(`${s}T12:00:00.000Z`);

let nes: string;
let snes: string;
beforeAll(async () => {
  await fs.mkdir(dir, { recursive: true });
});
afterAll(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});
beforeEach(async () => {
  await prisma.journalEntry.deleteMany();
  await prisma.playSession.deleteMany();
  await prisma.ownedGame.deleteMany();
  nes = (await prisma.ownedGame.create({ data: { title: "Contra", normalizedTitle: "contra", platform: "nes" } })).id;
  snes = (await prisma.ownedGame.create({ data: { title: "Contra III", normalizedTitle: "contra iii", platform: "snes" } })).id;
});

describe("journal entries", () => {
  it("requires writing in a note but not in a photo", async () => {
    expect(await status(() => addEntry(nes, { kind: "note", body: "" }))).toBe(400);
    expect(await status(() => addEntry(nes, { kind: "note", body: "   " }))).toBe(400);
    expect(await status(() => addEntry(nes, { kind: "note", title: "just a title" }))).toBe(400);
    const photo = await addEntry(nes, { kind: "photo" });
    expect(photo.body).toBeNull();
    expect([photo.width, photo.height]).toEqual([0, 0]);
    expect(await status(() => addEntry("nope", { kind: "note", body: "x" }))).toBe(404);
  });

  it("files an entry under a run of the same copy and 400s on another game's run", async () => {
    const mine = await startSession(nes);
    const theirs = await startSession(snes);
    expect((await addEntry(nes, { kind: "note", body: "beat the boss", sessionId: mine.id })).sessionId).toBe(mine.id);
    expect(await status(() => addEntry(nes, { kind: "note", body: "x", sessionId: theirs.id }))).toBe(400);
    expect(await status(() => addEntry(nes, { kind: "note", body: "x", sessionId: "nope" }))).toBe(404);
    // Unattached entries are fine — "I played this at my cousin's in 1994".
    expect((await addEntry(nes, { kind: "note", body: "played this at my cousin's" })).sessionId).toBeNull();
  });

  it("lists newest occurredAt first, per copy", async () => {
    await addEntry(nes, { kind: "note", body: "old", occurredAt: at("2019-01-01") });
    await addEntry(nes, { kind: "note", body: "new", occurredAt: at("2026-08-01") });
    await addEntry(snes, { kind: "note", body: "other copy" });
    expect((await entriesFor(nes)).map((e) => e.body)).toEqual(["new", "old"]);
    expect((await entriesFor(snes)).map((e) => e.body)).toEqual(["other copy"]);
  });

  it("edits in place, clears an explicit null, and keeps a note from being emptied", async () => {
    const run = await logPastSession(nes, { startedAt: at("2019-01-01"), endedAt: at("2019-02-01") });
    const e = await addEntry(nes, { kind: "note", body: "draft", title: "Day one" });
    const edited = await updateEntry(e.id, { body: "the last boss took four tries", sessionId: run.id });
    expect(edited).toMatchObject({ title: "Day one", body: "the last boss took four tries", sessionId: run.id });
    expect((await updateEntry(e.id, { title: null, sessionId: null })).title).toBeNull();
    expect((await prisma.journalEntry.findUniqueOrThrow({ where: { id: e.id } })).sessionId).toBeNull();
    expect(await status(() => updateEntry(e.id, { body: "" }))).toBe(400);
    expect(await status(() => updateEntry("nope", { body: "x" }))).toBe(404);
  });

  it("caps a game's journal", async () => {
    await prisma.journalEntry.createMany({
      data: Array.from({ length: MAX_ENTRIES_PER_GAME }, (_, i) => ({ ownedGameId: nes, kind: "note", body: `n${i}`, occurredAt: new Date(), updatedAt: new Date() })),
    });
    expect(await status(() => addEntry(nes, { kind: "note", body: "one too many" }))).toBe(409);
  });

  it("cascades entries away when the owned game is deleted", async () => {
    await addEntry(nes, { kind: "note", body: "x" });
    await prisma.ownedGame.delete({ where: { id: nes } });
    expect(await prisma.journalEntry.count()).toBe(0);
  });
});

describe("journal photos", () => {
  it("stores bytes, records the pixel size, and deletes the file with the entry", async () => {
    const e = await addEntry(nes, { kind: "photo", title: "the end screen" });
    const bytes = png(1200, 900);
    const saved = await setEntryImage(e.id, bytes);
    expect([saved.width, saved.height]).toEqual([1200, 900]);
    const got = await readEntryImage(e.id);
    expect(got!.contentType).toBe("image/png");
    expect(got!.buf.equals(bytes)).toBe(true);
    expect(await fs.readdir(dir)).toContain(`${e.id}.png`);

    await deleteEntry(e.id);
    expect(await readEntryImage(e.id)).toBeNull();
    expect(await fs.readdir(dir)).not.toContain(`${e.id}.png`);
  });

  it("drops the image when a photo is turned into a note", async () => {
    const e = await addEntry(nes, { kind: "photo", title: "the end screen" });
    await setEntryImage(e.id, png(800, 600));
    expect(await fs.readdir(dir)).toContain(`${e.id}.png`);

    const now = await updateEntry(e.id, { kind: "note", body: "describing it instead" });
    expect(now.kind).toBe("note");
    expect([now.width, now.height]).toEqual([0, 0]);
    expect(await readEntryImage(e.id)).toBeNull();
    expect(await fs.readdir(dir)).not.toContain(`${e.id}.png`);
  });

  it("keeps a bare date on an entry as the local calendar day", async () => {
    const e = await addEntry(nes, { kind: "note", body: "at my cousin's", occurredAt: entryInputSchema.parse({ kind: "note", body: "x", occurredAt: "1994-07-04" }).occurredAt });
    expect(e.occurredAt.getDate()).toBe(4);
    expect(e.occurredAt.getMonth()).toBe(6);
    expect(e.occurredAt.getHours()).toBe(0);
  });

  it("rejects an image on a note, a non-image body, and an unknown entry", async () => {
    const note = await addEntry(nes, { kind: "note", body: "words" });
    expect(await status(() => setEntryImage(note.id, png(2, 2)))).toBe(400);
    const photo = await addEntry(nes, { kind: "photo" });
    expect(await status(() => setEntryImage(photo.id, Buffer.from("GIF89a nope")))).toBe(415);
    expect(await status(() => setEntryImage("nope", png(2, 2)))).toBe(404);
  });
});
