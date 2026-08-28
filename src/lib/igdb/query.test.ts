import { describe, expect, it } from "vitest";
import { buildGameQuery, buildQuery } from "./query";

describe("buildGameQuery", () => {
  it("always emits a game_type filter that excludes mods (5)", () => {
    for (const q of [
      buildGameQuery({ fields: ["name"] }),
      buildGameQuery({ fields: ["name"], search: "Super Mario Bros" }),
      buildGameQuery({ fields: ["name"], ids: [1, 2] }),
    ]) {
      expect(q).toMatch(/game_type = \(0,3,8,9,10,11\)/);
      expect(q).not.toMatch(/game_type = \([^)]*\b5\b/);
    }
  });
  it("can narrow to main games only", () => {
    expect(buildGameQuery({ fields: ["name"], gameTypes: [0] })).toContain("where game_type = 0;");
  });
  it("refuses mod, DLC, fork and pack types", () => {
    for (const t of [1, 2, 5, 6, 7, 12, 13, 14]) {
      expect(() => buildGameQuery({ fields: ["name"], gameTypes: [0, t] }), `type ${t}`).toThrow();
    }
  });
  it("combines search, platform, ids and limit", () => {
    const q = buildGameQuery({ fields: ["name", "slug"], search: "Contra", platformIds: [18], limit: 10 });
    expect(q).toBe('search "Contra"; fields name, slug; where game_type = (0,3,8,9,10,11) & platforms = (18); limit 10;');
  });
  it("escapes quotes in search terms", () => {
    expect(buildGameQuery({ fields: ["name"], search: 'Say "hi"' })).toContain('search "Say \\"hi\\""');
  });
  it("uses singular platform on non-game queries via raw where", () => {
    expect(buildQuery({ fields: ["game_id"], where: ["game_id = (1,2)"], limit: 5 })).toBe("fields game_id; where game_id = (1,2); limit 5;");
  });
});
