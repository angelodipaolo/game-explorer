import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MusicManifestError } from "./manifest";

// The library reads MUSIC_DIR at import time, exactly as the image stores read
// MAPS_DIR/JOURNAL_DIR — point it at a scratch directory before loading it.
const dir = path.join(os.tmpdir(), `music-test-${process.pid}`);
const outside = path.join(os.tmpdir(), `music-test-outside-${process.pid}`);
process.env.MUSIC_DIR = dir;

const { MUSIC_DIR, clearIndexCache, findTrack, loadIndex, parseRange, readTrackBytes, resolveTrackPath } = await import("./library");

/**
 * A synthetic "MP3": an ID3v2 header and some bytes. Nothing here decodes
 * audio, and the owner's real files are never read by tests — the point is a
 * file of a known size at a known path.
 */
const fakeMp3 = (size: number) => {
  const buf = Buffer.alloc(size, 0x55);
  Buffer.from("ID3\x03\x00\x00\x00\x00\x00\x00", "latin1").copy(buf, 0);
  return buf;
};

const writeManifest = async (data: unknown) => {
  await fs.writeFile(path.join(dir, "index.json"), JSON.stringify(data, null, 2));
  clearIndexCache();
};

beforeAll(async () => {
  await fs.rm(dir, { recursive: true, force: true });
  await fs.rm(outside, { recursive: true, force: true });
  await fs.mkdir(path.join(dir, "castlevania"), { recursive: true });
  await fs.mkdir(outside, { recursive: true });
  await fs.writeFile(path.join(dir, "castlevania", "vampire-killer.mp3"), fakeMp3(4096));
  await fs.writeFile(path.join(outside, "secrets.mp3"), fakeMp3(64));
  await fs.symlink(path.join(outside, "secrets.mp3"), path.join(dir, "escape.mp3"));
  await writeManifest({
    version: 1,
    games: [
      {
        igdbId: 1258,
        title: "Castlevania",
        tracks: [
          { id: "cv-vampire-killer", title: "Vampire Killer", file: "castlevania/vampire-killer.mp3" },
          { id: "cv-missing", title: "Stalker", file: "castlevania/not-copied-yet.mp3" },
          { id: "cv-escape", title: "Escape", file: "escape.mp3" },
        ],
      },
    ],
  });
});

afterAll(async () => {
  await fs.rm(dir, { recursive: true, force: true });
  await fs.rm(outside, { recursive: true, force: true });
});

describe("resolveTrackPath", () => {
  it("resolves a relative file inside the directory", () => {
    expect(resolveTrackPath("/srv/data/music", "castlevania/a.mp3")).toBe("/srv/data/music/castlevania/a.mp3");
  });

  it("refuses anything that lands outside it", () => {
    for (const f of ["../a.mp3", "castlevania/../../a.mp3", "/etc/passwd", "..", "../../../../Users/angelo/Music/non-iTunes/x.mp3"]) {
      expect(() => resolveTrackPath("/srv/data/music", f), f).toThrow(MusicManifestError);
    }
  });
});

describe("loadIndex", () => {
  it("reads the manifest off disk and indexes it", async () => {
    const index = await loadIndex();
    expect(index.byIgdbId.get(1258)?.tracks).toHaveLength(3);
    expect(index.byTrackId.get("cv-vampire-killer")?.track.file).toBe("castlevania/vampire-killer.mp3");
  });

  it("treats an unparseable manifest as no music rather than an error", async () => {
    await fs.writeFile(path.join(dir, "index.json"), "{ not json");
    clearIndexCache();
    expect((await loadIndex()).manifest.games).toEqual([]);
    await writeManifest({ version: 1, games: [{ igdbId: 1258, title: "Castlevania", tracks: [{ id: "cv-vampire-killer", title: "Vampire Killer", file: "castlevania/vampire-killer.mp3" }, { id: "cv-missing", title: "Stalker", file: "castlevania/not-copied-yet.mp3" }, { id: "cv-escape", title: "Escape", file: "escape.mp3" }] }] });
    expect((await loadIndex()).byTrackId.size).toBe(3);
  });

  it("is empty when there is no data/music at all", async () => {
    await fs.rename(path.join(dir, "index.json"), path.join(dir, "index.json.bak"));
    clearIndexCache();
    expect((await loadIndex()).manifest.games).toEqual([]);
    await fs.rename(path.join(dir, "index.json.bak"), path.join(dir, "index.json"));
    clearIndexCache();
  });
});

describe("findTrack", () => {
  it("finds a registered track's bytes", async () => {
    const found = await findTrack("cv-vampire-killer");
    expect(found?.size).toBe(4096);
    expect(found?.path.startsWith(await fs.realpath(MUSIC_DIR))).toBe(true);
  });

  it("refuses a malicious id without touching the disk", async () => {
    for (const id of ["../../.env", "..%2f..%2f.env", "../secrets.mp3", "/etc/passwd", "castlevania/vampire-killer.mp3", "cv-vampire-killer.mp3", "", "..", "%2e%2e"]) {
      expect(await findTrack(id), id).toBeNull();
    }
    // Decoded traversal too: the route hands us the decoded segment.
    expect(await findTrack(decodeURIComponent("..%2F..%2Fsecrets.mp3"))).toBeNull();
  });

  it("returns null for an unregistered id", async () => {
    expect(await findTrack("cv-nope")).toBeNull();
  });

  it("returns null when the manifest names a file nobody copied across", async () => {
    expect(await findTrack("cv-missing")).toBeNull();
  });

  it("refuses a symlink that leaves the music directory", async () => {
    expect(await findTrack("cv-escape")).toBeNull();
  });
});

describe("readTrackBytes", () => {
  it("reads an inclusive byte range", async () => {
    const file = path.join(dir, "castlevania", "vampire-killer.mp3");
    expect((await readTrackBytes(file, 0, 9)).toString("latin1")).toBe("ID3\x03\x00\x00\x00\x00\x00\x00");
    expect((await readTrackBytes(file, 10, 19))).toHaveLength(10);
    // Past the end clamps to what is there rather than padding with zeroes.
    expect((await readTrackBytes(file, 4090, 5000))).toHaveLength(6);
  });
});

describe("parseRange", () => {
  it("passes through when nothing was asked for", () => {
    expect(parseRange(null, 100)).toBeNull();
    expect(parseRange("", 100)).toBeNull();
    expect(parseRange("bytes=-", 100)).toBeNull();
    // Multi-range: legal to answer with the whole file.
    expect(parseRange("bytes=0-10,20-30", 100)).toBeNull();
    expect(parseRange("items=0-10", 100)).toBeNull();
  });

  it("reads the three shapes a media element sends", () => {
    expect(parseRange("bytes=0-", 100)).toEqual({ start: 0, end: 99 });
    expect(parseRange("bytes=10-19", 100)).toEqual({ start: 10, end: 19 });
    expect(parseRange("bytes=-20", 100)).toEqual({ start: 80, end: 99 });
    expect(parseRange("bytes=90-500", 100)).toEqual({ start: 90, end: 99 });
  });

  it("calls out a range that cannot be satisfied", () => {
    expect(parseRange("bytes=100-", 100)).toBe("unsatisfiable");
    expect(parseRange("bytes=50-10", 100)).toBe("unsatisfiable");
    expect(parseRange("bytes=-0", 100)).toBe("unsatisfiable");
  });
});
