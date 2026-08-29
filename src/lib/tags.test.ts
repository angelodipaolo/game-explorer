import { describe, expect, it } from "vitest";
import { resolveTags, tagKey } from "./tags";

const igdb = { genres: ["Platform"], perspectives: ["Side view"], themes: ["Fantasy"] };

describe("tags", () => {
  it("normalises keys", () => {
    expect(tagKey("Metroidvania")).toBe("metroidvania");
    expect(tagKey(" Couch Co-op! ")).toBe("couch co op");
  });
  it("unions IGDB with manual and agent tags, and hides IGDB ones on request", () => {
    const out = resolveTags(igdb, [
      { key: "metroidvania", tag: "Metroidvania", source: "agent", sourceUrl: "https://x" },
      { key: "couch co op", tag: "couch co-op", source: "manual" },
      { key: "fantasy", tag: "Fantasy", source: "igdb-hide" },
    ]);
    expect(out.map((t) => `${t.tag}:${t.source}`).sort()).toEqual(["Metroidvania:agent", "Platform:igdb", "Side view:igdb", "couch co-op:manual"]);
  });
  it("manual beats agent; IGDB is not duplicated by either", () => {
    const out = resolveTags(igdb, [
      { key: "metroidvania", tag: "metroidvania", source: "agent" },
      { key: "metroidvania", tag: "Metroidvania", source: "manual" },
      { key: "platform", tag: "Platformer", source: "agent" },
    ]);
    expect(out.find((t) => t.key === "metroidvania")).toMatchObject({ tag: "Metroidvania", source: "manual" });
    expect(out.find((t) => t.key === "platform")).toMatchObject({ tag: "Platform", source: "igdb" });
  });
});
