import { describe, expect, it } from "vitest";
import { resolvePlatform } from "./platforms";

describe("resolvePlatform", () => {
  it("maps every NES alias to one slug", () => {
    for (const s of ["Nintendo Entertainment System", "Nintendo", "NES", "nes", " N.E.S. ", "Famicom"]) {
      expect(resolvePlatform(s)?.slug, s).toBe("nes");
    }
  });
  it("distinguishes SNES from NES", () => {
    expect(resolvePlatform("Super Nintendo")?.slug).toBe("snes");
    expect(resolvePlatform("SNES")?.slug).toBe("snes");
  });
  it("returns null for unknowns and blanks", () => {
    expect(resolvePlatform("")).toBeNull();
    expect(resolvePlatform("Ouya")).toBeNull();
    expect(resolvePlatform(null)).toBeNull();
  });
  it("carries IGDB ids", () => {
    expect(resolvePlatform("PlayStation")?.igdbId).toBe(7);
    expect(resolvePlatform("NES")?.igdbId).toBe(18);
  });
});
