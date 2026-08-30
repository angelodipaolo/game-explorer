import fs from "node:fs/promises";
import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { MAPS_DIR, sniffImage } from "./image";
import { slugify } from "./kinds";
import { addMap, listMapGaps, mapsFor, removeMap, setMapImage, updateMarker, writeMarkers } from "./service";

let id: string;
beforeEach(async () => {
  await prisma.gameMap.deleteMany();
  await prisma.ownedGame.deleteMany();
  id = (await prisma.ownedGame.create({ data: { title: "Final Fantasy IV", normalizedTitle: "final fantasy iv", platform: "snes" } })).id;
});

/** A 2×3 PNG: signature + IHDR is all sniffImage reads. */
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

describe("slugify / sniffImage", () => {
  it("makes url-safe slugs", () => {
    expect(slugify("Lunar Path 1 (north)")).toBe("lunar-path-1-north");
    expect(slugify("  Overworld  ")).toBe("overworld");
  });
  it("reads png and jpeg sizes and rejects the rest", () => {
    expect(sniffImage(png(4096, 2048))).toEqual({ format: "png", width: 4096, height: 2048 });
    // Minimal JPEG: SOI, then a SOF0 segment with height 300, width 400.
    const jpg = Buffer.from([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x01, 0x2c, 0x01, 0x90, 0x03]);
    expect(sniffImage(jpg)).toEqual({ format: "jpeg", width: 400, height: 300 });
    expect(sniffImage(Buffer.from("not an image"))).toBeNull();
  });
});

describe("maps service", () => {
  it("creates a map, slugs the title, and refreshes in place on the same slug", async () => {
    const a = await addMap(id, { title: "Overworld", subtitle: "Blue Planet" });
    expect(a.slug).toBe("overworld");
    const b = await addMap(id, { title: "Overworld", subtitle: "The Blue Planet", sourceUrl: "https://example.com/map.png" });
    expect(b.id).toBe(a.id);
    expect(b.subtitle).toBe("The Blue Planet");
    expect((await mapsFor(id)).length).toBe(1);
    expect(await status(() => addMap("nope", { title: "x" }))).toBe(404);
  });

  it("stores the image and records its size; markers are range-checked against it", async () => {
    const m = await addMap(id, { title: "Moon" });
    expect(await status(() => setMapImage(m.id, Buffer.from("junk")))).toBe(415);
    const withImage = await setMapImage(m.id, png(1024, 1024));
    expect([withImage.width, withImage.height]).toEqual([1024, 1024]);
    const r = await writeMarkers(m.id, [
      { name: "Lunar's Lair", kind: "castle", x: 360, y: 560 },
      { name: "Off the edge", kind: "cave", x: 2000, y: 10 },
      { name: "Odd", kind: "spaceship", x: 1, y: 1 },
    ]);
    expect(r.written.map((w) => w.name)).toEqual(["Lunar's Lair"]);
    expect(r.skipped.map((s) => s.name)).toEqual(["Off the edge", "Odd"]);
    await removeMap(m.id);
    await expect(fs.access(`${MAPS_DIR}/${m.id}.png`)).rejects.toBeTruthy();
  });

  it("upserts markers by name, and replace drops the rest", async () => {
    const m = await addMap(id, { title: "Underworld" });
    await writeMarkers(m.id, [
      { name: "Tomra", kind: "town", x: 1, y: 2 },
      { name: "Sealed Cave", kind: "dungeon", x: 3, y: 4 },
    ]);
    const r = await writeMarkers(m.id, [{ name: "Tomra", kind: "town", x: 10, y: 20, note: "Good shops." }], true);
    expect(r.removed).toBe(1);
    const [only] = (await mapsFor(id))[0].markers;
    expect([only.name, only.x, only.note]).toEqual(["Tomra", 10, "Good shops."]);
    const [one] = (await mapsFor(id))[0].markers;
    expect(await status(() => updateMarker(m.id, one.id, { kind: "blimp" }))).toBe(400);
    const moved = await updateMarker(m.id, one.id, { x: 11 });
    expect(moved.x).toBe(11);
  });

  it("lists games with no maps", async () => {
    expect((await listMapGaps()).total).toBe(1);
    await addMap(id, { title: "Overworld" });
    expect((await listMapGaps()).total).toBe(0);
  });
});
