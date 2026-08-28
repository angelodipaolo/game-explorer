import { describe, expect, it } from "vitest";
import { compactKey, normalizeTitle, stripBrackets, titleVariants, unrotateArticle } from "./normalize";

describe("normalizeTitle", () => {
  it("collapses punctuation, case and whitespace", () => {
    expect(normalizeTitle("Super Mario Bros.")).toBe("super mario bros");
    expect(normalizeTitle("  Top Loading Nintendo  Console ")).toBe("top loading nintendo console");
    expect(normalizeTitle("Pokémon: Red")).toBe("pokemon red");
    expect(normalizeTitle("Chip 'n Dale")).toBe("chip n dale");
    expect(normalizeTitle("Rock & Roll")).toBe("rock and roll");
    expect(normalizeTitle("Super Mario Bros. / Duck Hunt")).toBe("super mario bros and duck hunt");
  });
});

describe("variants", () => {
  it("strips bracketed publishers", () => {
    expect(stripBrackets("Pac-Man [Tengen]")).toBe("Pac-Man");
    expect(stripBrackets("Tetris (Tengen)")).toBe("Tetris");
  });
  it("puts articles back in front", () => {
    expect(unrotateArticle("Legend of Zelda, The")).toBe("The Legend of Zelda");
  });
  it("produces raw, stripped and space-collapsed variants", () => {
    expect(titleVariants("Duck Tales")).toEqual(["Duck Tales", "DuckTales"]);
    expect(titleVariants("Pac-Man [Tengen]")).toEqual(["Pac-Man [Tengen]", "Pac-Man"]);
    expect(titleVariants("Duck Tales 2")).toEqual(["Duck Tales 2", "DuckTales 2"]);
    expect(titleVariants("Star Tropics II: Zoda's Revenge")).toEqual([
      "Star Tropics II: Zoda's Revenge",
      "StarTropics II: Zoda's Revenge",
      "Star Tropics II",
      "StarTropics II",
    ]);
    expect(titleVariants("Legend of Zelda, The")).toEqual(["Legend of Zelda, The", "The Legend of Zelda", "TheLegendofZelda"]);
  });
  it("compact keys equate spaced and unspaced spellings", () => {
    expect(compactKey("Duck Tales")).toBe(compactKey("DuckTales"));
    expect(compactKey("Star Tropics")).toBe(compactKey("StarTropics"));
  });
});
