import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { MAX_BOOKMARKS_PER_GAME, urlKeyOf } from "./kinds";
import { addBookmark, addBookmarks, bookmarkInputSchema, bookmarksFor, listBookmarkGaps, removeBookmark, updateBookmark, type BookmarkInput } from "./service";

let id: string;
let other: string;
beforeEach(async () => {
  await prisma.gameBookmark.deleteMany();
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

/** A valid bookmark, with anything you want swapped out. `kind` stays a plain
 *  string in `raw` so the batch tests can hand the API an unknown one. */
const raw = (over: Omit<Partial<BookmarkInput>, "kind"> & { kind?: string } = {}) => ({
  kind: "guide",
  url: "https://gamefaqs.gamespot.com/nes/563406-contra/faqs/1",
  title: "Contra — FAQ/Walkthrough",
  why: "Stage by stage for the NES release",
  ...over,
});
const bm = (over: Partial<BookmarkInput> = {}): BookmarkInput => raw(over) as BookmarkInput;

describe("urlKeyOf", () => {
  it("ignores scheme, www, trailing slash, fragment and tracking query", () => {
    const key = urlKeyOf("https://www.example.test/guide/");
    expect(urlKeyOf("http://example.test/guide")).toBe(key);
    expect(urlKeyOf("https://EXAMPLE.test/guide#part-3")).toBe(key);
    expect(urlKeyOf("https://example.test/guide/?utm_source=x&fbclid=y")).toBe(key);
  });

  it("keeps the query parameters that pick the page, in a stable order", () => {
    expect(urlKeyOf("https://youtube.com/watch?v=abc&t=90")).toBe(urlKeyOf("https://www.youtube.com/watch?t=90&v=abc"));
    expect(urlKeyOf("https://youtube.com/watch?v=abc")).not.toBe(urlKeyOf("https://youtube.com/watch?v=xyz"));
  });

  it("folds only the host — paths and query values stay case-sensitive", () => {
    // Two real, different pages. Folding the whole key would collapse them onto
    // one row through the unique (ownedGameId, urlKey).
    expect(urlKeyOf("https://en.wikipedia.org/wiki/Contra_(video_game)")).not.toBe(urlKeyOf("https://en.wikipedia.org/wiki/contra_(video_game)"));
    expect(urlKeyOf("https://youtube.com/watch?v=dQw4w9WgXcQ")).not.toBe(urlKeyOf("https://youtube.com/watch?v=dqw4w9wgxcq"));
    // The host still folds, so these are one page.
    expect(urlKeyOf("https://EN.WIKIPEDIA.ORG/wiki/Contra")).toBe(urlKeyOf("https://en.wikipedia.org/wiki/Contra"));
  });

  it("re-encodes query values, so an escaped separator is not a second parameter", () => {
    // One parameter whose value contains "&v=" — not the same page as two.
    expect(urlKeyOf("https://s.test/search?q=hello%26v%3Dy")).not.toBe(urlKeyOf("https://s.test/search?q=hello&v=y"));
    expect(urlKeyOf("https://s.test/search?q=a%20b")).toBe(urlKeyOf("https://s.test/search?q=a+b"));
  });
});

describe("bookmark input", () => {
  it("takes http and https and refuses every other scheme", () => {
    expect(bookmarkInputSchema.safeParse(raw({ url: "http://example.test/x" })).success).toBe(true);
    expect(bookmarkInputSchema.safeParse(raw({ url: "https://example.test/x" })).success).toBe(true);
    for (const url of ["javascript:alert(1)", "data:text/html,<script>", "file:///etc/passwd", "ftp://example.test/x", "example.test/x", "not a url"]) {
      expect(bookmarkInputSchema.safeParse(raw({ url })).success, url).toBe(false);
    }
  });

  it("requires a why — the line that says what makes this the link to open", () => {
    expect(bookmarkInputSchema.safeParse(raw({ why: "" })).success).toBe(false);
    expect(bookmarkInputSchema.safeParse(raw({ why: "   " })).success).toBe(false);
    expect(bookmarkInputSchema.safeParse(raw({ title: "" })).success).toBe(false);
  });
});

describe("bookmarks service", () => {
  it("adds, dedupes on the normalised url, and refreshes in place", async () => {
    const a = await addBookmark(id, bm());
    const b = await addBookmark(id, bm({ url: "http://www.gamefaqs.gamespot.com/nes/563406-contra/faqs/1?utm_source=x", title: "Contra — FAQ/Walkthrough by CyricZ", why: "Best one" }));
    expect(b.id).toBe(a.id);
    expect(await prisma.gameBookmark.count()).toBe(1);
    expect(b).toMatchObject({ title: "Contra — FAQ/Walkthrough by CyricZ", why: "Best one" });
    // The same page under a different kind is still the same page: one row.
    const c = await addBookmark(id, bm({ kind: "wiki" }));
    expect(c.id).toBe(a.id);
    expect(c.kind).toBe("wiki");
  });

  it("orders by kind then position, and bookmarks belong to one copy only", async () => {
    await addBookmark(id, bm({ kind: "wiki", url: "https://w.test/a", title: "Wiki" }));
    await addBookmark(id, bm({ url: "https://g.test/b", title: "Guide B", position: 1 }));
    await addBookmark(id, bm({ url: "https://g.test/a", title: "Guide A", position: 0 }));
    await addBookmark(other, bm({ url: "https://g.test/snes", title: "SNES only" }));
    expect((await bookmarksFor(id)).map((b) => b.title)).toEqual(["Guide A", "Guide B", "Wiki"]);
    expect((await bookmarksFor(other)).map((b) => b.title)).toEqual(["SNES only"]);
  });

  it("leaves untouched fields alone but clears an explicit null", async () => {
    const a = await addBookmark(id, bm({ note: "mirrors the printed guide" }));
    const b = await updateBookmark(a.id, { title: "Renamed" });
    expect(b).toMatchObject({ title: "Renamed", why: "Stage by stage for the NES release", note: "mirrors the printed guide" });
    expect((await updateBookmark(a.id, { note: null })).note).toBeNull();
  });

  it("keeps two same-host pages that differ only in path case as separate rows", async () => {
    const a = await addBookmark(id, bm({ url: "https://en.wikipedia.org/wiki/Contra_(video_game)", title: "Upper" }));
    const b = await addBookmark(id, bm({ url: "https://en.wikipedia.org/wiki/contra_(video_game)", title: "lower" }));
    expect(b.id).not.toBe(a.id);
    expect(await prisma.gameBookmark.count({ where: { ownedGameId: id } })).toBe(2);
  });

  it("409s when an edit collides with a sibling, 404s on an unknown id", async () => {
    const a = await addBookmark(id, bm({ url: "https://g.test/a" }));
    const b = await addBookmark(id, bm({ url: "https://g.test/b" }));
    expect(await status(() => updateBookmark(b.id, { url: "https://www.g.test/a/" }))).toBe(409);
    expect(await status(() => updateBookmark("nope", { title: "x" }))).toBe(404);
    expect(await status(() => removeBookmark("nope"))).toBe(404);
    expect(await status(() => addBookmark("nope", bm()))).toBe(404);
    // The same URL on the *other* copy is a different row, not a clash.
    await addBookmark(other, bm({ url: "https://g.test/a" }));
    await removeBookmark(a.id);
    expect(await prisma.gameBookmark.count()).toBe(2);
  });

  it("caps a game at MAX_BOOKMARKS_PER_GAME", async () => {
    for (let i = 0; i < MAX_BOOKMARKS_PER_GAME; i++) await addBookmark(id, bm({ url: `https://g.test/${i}`, title: `Guide ${i}` }));
    expect(await status(() => addBookmark(id, bm({ url: "https://g.test/one-too-many" })))).toBe(409);
    // An update of an existing row is still allowed at the cap.
    await addBookmark(id, bm({ url: "https://g.test/0", title: "Guide 0 revised" }));
    expect(await prisma.gameBookmark.count({ where: { ownedGameId: id } })).toBe(MAX_BOOKMARKS_PER_GAME);
  });

  it("writes a batch partially, reporting each skip with a reason", async () => {
    for (let i = 0; i < MAX_BOOKMARKS_PER_GAME - 1; i++) await addBookmark(other, bm({ url: `https://g.test/${i}`, title: `Guide ${i}` }));
    const r = await addBookmarks([
      { ownedGameId: id, ...raw({ url: "https://g.test/one", title: "One" }) },
      { ownedGameId: id, ...raw({ kind: "podcast", url: "https://g.test/two", title: "Two" }) },
      { ownedGameId: "missing", ...raw({ url: "https://g.test/three", title: "Three" }) },
      { ownedGameId: other, ...raw({ url: "https://g.test/last", title: "The last slot" }) },
      { ownedGameId: other, ...raw({ url: "https://g.test/nope", title: "One too many" }) },
    ]);
    expect(r.written.map((w) => w.title)).toEqual(["One", "The last slot"]);
    expect(r.skipped.map((s) => `${s.title}: ${s.reason}`)).toEqual([
      "Two: unknown kind — expected one of guide, wiki, video, longplay, article",
      "Three: owned game not found",
      `One too many: already at the ${MAX_BOOKMARKS_PER_GAME}-bookmark limit`,
    ]);
    expect((await bookmarksFor(id))[0].why).toBe("Stage by stage for the NES release");
  });

  it("counts a batch's own writes against the cap rather than a stale count", async () => {
    const r = await addBookmarks(
      Array.from({ length: MAX_BOOKMARKS_PER_GAME + 2 }, (_, i) => ({ ownedGameId: id, ...raw({ url: `https://g.test/${i}`, title: `Guide ${i}` }) })),
    );
    expect(r.written).toHaveLength(MAX_BOOKMARKS_PER_GAME);
    expect(r.skipped).toHaveLength(2);
    expect(await prisma.gameBookmark.count({ where: { ownedGameId: id } })).toBe(MAX_BOOKMARKS_PER_GAME);
  });

  it("lists gaps per copy, filtered by kind", async () => {
    await addBookmark(id, bm());
    const all = await listBookmarkGaps();
    expect(all.gaps.map((g) => g.ownedGameId)).toEqual([other]);
    const longplays = await listBookmarkGaps(["longplay"]);
    expect(longplays.total).toBe(2);
    expect(longplays.gaps.find((g) => g.ownedGameId === id)?.have).toEqual({ guide: 1 });
    expect(longplays.gaps[0].platform).toBeTruthy();
  });

  it("cascades bookmarks away when the owned game is deleted", async () => {
    await addBookmark(id, bm());
    await prisma.ownedGame.delete({ where: { id } });
    expect(await prisma.gameBookmark.count()).toBe(0);
  });
});
