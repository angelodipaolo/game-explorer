import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";

// The music store reads MUSIC_DIR at import time, exactly as the image stores
// read MAPS_DIR/MANUALS_DIR — point it at a scratch directory before the module
// under test is loaded.
const dir = path.join(os.tmpdir(), `music-test-${process.pid}`);
process.env.MUSIC_DIR = dir;

const { MAX_AUDIO_BYTES, MAX_TRACKS_PER_GAME, addTrack, findTrackFile, playableTracksFor, removeTrack, renameTrack, setTrackAudio, trackInputSchema, tracksFor } = await import("./service");

/** A synthetic MP3: an ID3 tag and filler. The owner's own files are never touched by tests. */
const mp3 = (size = 2048) => {
  const b = Buffer.alloc(size, 0x55);
  Buffer.from("ID3", "latin1").copy(b, 0);
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

const fileFor = (trackId: string) => path.join(dir, `${trackId}.mp3`);
const exists = (file: string) =>
  fs
    .access(file)
    .then(() => true)
    .catch(() => false);

let nes: string;
let snes: string;
beforeAll(async () => {
  await fs.mkdir(dir, { recursive: true });
});
afterAll(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});
beforeEach(async () => {
  await prisma.musicTrack.deleteMany();
  await prisma.ownedGame.deleteMany();
  nes = (await prisma.ownedGame.create({ data: { title: "Castlevania", normalizedTitle: "castlevania", platform: "nes" } })).id;
  snes = (await prisma.ownedGame.create({ data: { title: "Super Castlevania IV", normalizedTitle: "super castlevania iv", platform: "snes" } })).id;
});

describe("music tracks", () => {
  it("registers a track against one copy only", async () => {
    const track = await addTrack(nes, { title: "Vampire Killer" });
    expect(track.bytes).toBe(0);
    expect(track.contentType).toBe("audio/mpeg");
    expect((await tracksFor(nes)).map((t) => t.title)).toEqual(["Vampire Killer"]);
    // The NES and SNES copies of a game have different soundtracks — that is
    // why this hangs off the owned copy and not the catalog game.
    expect(await tracksFor(snes)).toEqual([]);
    expect(await status(() => addTrack("nope", { title: "x" }))).toBe(404);
  });

  it("keeps non-ASCII titles exactly as written", async () => {
    // The first implementation had an ASCII-only filename rule that rejected
    // real soundtrack names. Titles never touch a path; they are just text.
    for (const title of ["Étude", "Zelda – Overworld", "ドラキュラ伝説"]) {
      expect((await addTrack(nes, { title })).title).toBe(title);
    }
  });

  it("caps a game's tracks", async () => {
    for (let i = 0; i < MAX_TRACKS_PER_GAME; i++) await addTrack(nes, { title: `Track ${i}` });
    expect(await status(() => addTrack(nes, { title: "one too many" }))).toBe(409);
  });

  it("uploads audio, records its size, and serves it back by id", async () => {
    const track = await addTrack(nes, { title: "Vampire Killer" });
    const bytes = mp3(4096);
    expect((await setTrackAudio(track.id, bytes)).bytes).toBe(4096);
    expect(await exists(fileFor(track.id))).toBe(true);

    const found = await findTrackFile(track.id);
    expect(found?.file.size).toBe(4096);
    expect(found?.file.contentType).toBe("audio/mpeg");
    expect(found?.file.path.startsWith(await fs.realpath(dir))).toBe(true);
  });

  it("refuses anything that is not an MP3, and anything too large", async () => {
    const track = await addTrack(nes, { title: "Stalker" });
    expect(await status(() => setTrackAudio(track.id, Buffer.from("RIFF....WAVEfmt ")))).toBe(415);
    expect(await status(() => setTrackAudio(track.id, Buffer.alloc(MAX_AUDIO_BYTES + 1)))).toBe(413);
    expect(await status(() => setTrackAudio("nope", mp3()))).toBe(404);
    // Nothing was written for any of them.
    expect(await exists(fileFor(track.id))).toBe(false);
  });

  it("lists only tracks that actually have audio", async () => {
    const ready = await addTrack(nes, { title: "Vampire Killer" });
    await addTrack(nes, { title: "Not uploaded yet" });
    await setTrackAudio(ready.id, mp3());
    expect(await playableTracksFor(nes)).toEqual([{ id: ready.id, title: "Vampire Killer" }]);
    // Ids and titles, and nothing about the disk: this is a public response.
    expect(Object.keys((await playableTracksFor(nes))[0])).toEqual(["id", "title"]);
  });

  it("unlinks the file when the track is deleted", async () => {
    const track = await addTrack(nes, { title: "Vampire Killer" });
    await setTrackAudio(track.id, mp3());
    expect(await exists(fileFor(track.id))).toBe(true);

    await removeTrack(track.id);
    expect(await exists(fileFor(track.id))).toBe(false);
    expect(await findTrackFile(track.id)).toBeNull();
    expect(await tracksFor(nes)).toEqual([]);
    expect(await status(() => removeTrack(track.id))).toBe(404);
  });

  /**
   * The ids the serve route is handed by strangers: it is public, and
   * `path.join(dir, id + ".mp3")` resolves `..` and `/` happily. Every one is a
   * null here, which the route turns into a flat 404.
   */
  it("refuses a hostile track id without touching the disk", async () => {
    await fs.writeFile(path.join(dir, "secret.mp3"), mp3(16));
    for (const id of ["../../.env", "../secret", "/etc/passwd", "castlevania/vampire-killer.mp3", "a.mp3", "", "..", "%2e%2e", decodeURIComponent("..%2F..%2Fsecret")]) {
      expect(await findTrackFile(id), id).toBeNull();
    }
  });

  it("is silent for a track whose audio was never uploaded", async () => {
    const track = await addTrack(nes, { title: "Stalker" });
    expect(await findTrackFile(track.id)).toBeNull();
  });

  it("retitles a track", async () => {
    const track = await addTrack(nes, { title: "Vampire Killer" });
    const renamed = await renameTrack(track.id, { title: "Vampire Killer (Stage 1)" });
    expect(renamed.title).toBe("Vampire Killer (Stage 1)");
    expect((await tracksFor(nes))[0].title).toBe("Vampire Killer (Stage 1)");
    // Nothing else about the row moves for a retitle.
    expect(renamed.id).toBe(track.id);
    expect(renamed.bytes).toBe(track.bytes);
  });

  it("404s retitling a track that does not exist", async () => {
    expect(await status(() => renameTrack("nope", { title: "x" }))).toBe(404);
  });

  it("rejects a blank or oversize title", () => {
    // trackInputSchema is shared by POST (addTrack) and PATCH (renameTrack); a
    // route parses a request body with it before either function is called, and
    // `handle()` turns the resulting ZodError into a 400 — so the schema
    // rejecting the value here is what makes the API answer 400.
    expect(trackInputSchema.safeParse({ title: "" }).success).toBe(false);
    expect(trackInputSchema.safeParse({ title: "   " }).success).toBe(false);
    expect(trackInputSchema.safeParse({ title: "x".repeat(121) }).success).toBe(false);
    expect(trackInputSchema.safeParse({ title: "x".repeat(120) }).success).toBe(true);
  });

  it("goes away with the copy it belongs to", async () => {
    const track = await addTrack(nes, { title: "Vampire Killer" });
    await setTrackAudio(track.id, mp3());
    await prisma.ownedGame.delete({ where: { id: nes } });
    expect(await prisma.musicTrack.count({ where: { id: track.id } })).toBe(0);
    // The row cascades; the bytes do not. Same gap as maps, journal and
    // manuals — orphaned files are harmless, just never reclaimed.
    expect(await exists(fileFor(track.id))).toBe(true);
    await fs.rm(fileFor(track.id), { force: true });
  });
});
