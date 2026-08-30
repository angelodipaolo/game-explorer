import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { MAX_CODES_PER_GAME, codeKeyOf } from "./kinds";
import { addCode, addCodes, codesFor, listCodeGaps, removeCode, updateCode } from "./service";

let id: string;
let other: string;
beforeEach(async () => {
  await prisma.gameCode.deleteMany();
  await prisma.ownedGame.deleteMany();
  id = (await prisma.ownedGame.create({ data: { title: "Contra", normalizedTitle: "contra", platform: "nes" } })).id;
  other = (await prisma.ownedGame.create({ data: { title: "Contra", normalizedTitle: "contra", platform: "snes" } })).id;
});

const status = async (fn: () => Promise<unknown>) => {
  try {
    await fn();
    return 0;
  } catch (e) {
    return (e as { status: number }).status;
  }
};

describe("codeKeyOf", () => {
  it("ignores case and punctuation, and falls back to the effect", () => {
    expect(codeKeyOf("sx-io po", "x")).toBe("SXIOPO");
    expect(codeKeyOf("SXIOPO", "x")).toBe("SXIOPO");
    expect(codeKeyOf(null, "Infinite lives!")).toBe("INFINITELIVES");
    expect(codeKeyOf("", "Level select")).toBe("LEVELSELECT");
  });
});

describe("codes service", () => {
  it("adds, dedupes on the normalised code, and edits in place", async () => {
    const a = await addCode(id, { kind: "game-genie", effect: "30 lives", code: "SXIOPO" });
    const b = await addCode(id, { kind: "game-genie", effect: "30 lives on the Konami code", code: "sx-io-po" });
    expect(b.id).toBe(a.id);
    expect(await prisma.gameCode.count()).toBe(1);
    expect(b.effect).toBe("30 lives on the Konami code");
    // Same normalised code under a different kind is a different row.
    await addCode(id, { kind: "password", effect: "30 lives", code: "SXIOPO" });
    expect(await prisma.gameCode.count()).toBe(2);
  });

  it("keys a code-less cheat off its effect", async () => {
    const c = await addCode(id, { kind: "cheat", effect: "Infinite lives", howTo: "Up Up Down Down…" });
    expect(c.code).toBeNull();
    expect(c.codeKey).toBe("INFINITELIVES");
    await addCode(id, { kind: "cheat", effect: "infinite lives!" });
    expect(await prisma.gameCode.count()).toBe(1);
  });

  it("orders by kind then position, and codes belong to one copy only", async () => {
    await addCode(id, { kind: "cheat", effect: "Level select" });
    await addCode(id, { kind: "password", effect: "Level 5", code: "AAAA", position: 1 });
    await addCode(id, { kind: "password", effect: "Level 2", code: "BBBB", position: 0 });
    await addCode(other, { kind: "password", effect: "SNES only", code: "CCCC" });
    expect((await codesFor(id)).map((c) => c.effect)).toEqual(["Level 2", "Level 5", "Level select"]);
    expect((await codesFor(other)).map((c) => c.effect)).toEqual(["SNES only"]);
  });

  it("leaves untouched fields alone but clears them on an explicit null", async () => {
    const a = await addCode(id, { kind: "password", effect: "Level 5", code: "AAAA", note: "from the manual", verified: true });
    const b = await updateCode(id, a.id, { effect: "Level five" });
    expect(b).toMatchObject({ note: "from the manual", verified: true, effect: "Level five" });
    const c = await updateCode(id, a.id, { note: null, verified: false });
    expect(c.note).toBeNull();
    expect(c.verified).toBe(false);
  });

  it("409s when an edit collides with a sibling, 404s on an unknown id", async () => {
    await addCode(id, { kind: "password", effect: "Level 2", code: "AAAA" });
    const b = await addCode(id, { kind: "password", effect: "Level 5", code: "BBBB" });
    expect(await status(() => updateCode(id, b.id, { code: "aaaa" }))).toBe(409);
    expect(await status(() => updateCode(id, "nope", { effect: "x" }))).toBe(404);
    expect(await status(() => updateCode(other, b.id, { effect: "x" }))).toBe(404);
    expect(await status(() => removeCode(other, b.id))).toBe(404);
    expect(await status(() => addCode("nope", { kind: "cheat", effect: "x" }))).toBe(404);
    await removeCode(id, b.id);
    expect(await prisma.gameCode.count()).toBe(1);
  });

  it("caps a game at MAX_CODES_PER_GAME", async () => {
    for (let i = 0; i < MAX_CODES_PER_GAME; i++) await addCode(id, { kind: "password", effect: `Level ${i}`, code: `C${i}` });
    expect(await status(() => addCode(id, { kind: "password", effect: "one too many", code: "ZZZZ" }))).toBe(409);
    // An update of an existing row is still allowed at the cap.
    await addCode(id, { kind: "password", effect: "Level 0 revised", code: "C0" });
    expect(await prisma.gameCode.count({ where: { ownedGameId: id } })).toBe(MAX_CODES_PER_GAME);
  });

  it("writes a batch partially, reporting each skip with a reason", async () => {
    for (let i = 0; i < MAX_CODES_PER_GAME - 1; i++) await addCode(other, { kind: "password", effect: `Level ${i}`, code: `C${i}` });
    const r = await addCodes([
      { ownedGameId: id, kind: "game-genie", effect: "30 lives", code: "SXIOPO", sourceUrl: "https://example.test/contra" },
      { ownedGameId: id, kind: "shark", effect: "nope", code: "AAAA" },
      { ownedGameId: "missing", kind: "cheat", effect: "nope" },
      { ownedGameId: other, kind: "password", effect: "the last slot", code: "YYYY" },
      { ownedGameId: other, kind: "password", effect: "one too many", code: "ZZZZ" },
    ]);
    expect(r.written.map((w) => w.effect)).toEqual(["30 lives", "the last slot"]);
    expect(r.skipped.map((s) => `${s.effect}: ${s.reason}`)).toEqual([
      "nope: unknown kind — expected one of password, cheat, game-genie, action-replay",
      "nope: owned game not found",
      `one too many: already at the ${MAX_CODES_PER_GAME}-code limit`,
    ]);
    expect((await codesFor(id))[0].sourceUrl).toBe("https://example.test/contra");
  });

  it("lists gaps per copy, filtered by kind", async () => {
    await addCode(id, { kind: "password", effect: "Level 5", code: "AAAA" });
    const all = await listCodeGaps();
    expect(all.gaps.map((g) => g.ownedGameId)).toEqual([other]);
    const genie = await listCodeGaps(["game-genie"]);
    expect(genie.total).toBe(2);
    expect(genie.gaps.find((g) => g.ownedGameId === id)?.have).toEqual({ password: 1 });
    expect(genie.gaps[0].platform).toBeTruthy();
  });
});
