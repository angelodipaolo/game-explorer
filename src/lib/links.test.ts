import { describe, expect, it } from "vitest";
import { buildEbaySearchUrl, buildEbaySoldSearchUrl, buildPriceChartingSearchUrl, platformSearchTerms, searchTerm } from "./links";

describe("searchTerm", () => {
  it("appends the platform when it is known", () => {
    expect(searchTerm("EarthBound", "Super Nintendo Entertainment System")).toBe("EarthBound Super Nintendo Entertainment System");
  });
  it("falls back to the bare title without a platform", () => {
    expect(searchTerm("EarthBound")).toBe("EarthBound");
    expect(searchTerm("EarthBound", null)).toBe("EarthBound");
    expect(searchTerm("EarthBound", "   ")).toBe("EarthBound");
  });
  it("collapses stray whitespace", () => {
    expect(searchTerm("  Super   Mario Bros. 3 ", " NES ")).toBe("Super Mario Bros. 3 NES");
  });
});

describe("buildPriceChartingSearchUrl", () => {
  it("searches the prices tab", () => {
    expect(buildPriceChartingSearchUrl("EarthBound", "Super Nintendo Entertainment System")).toBe("https://www.pricecharting.com/search-products?q=EarthBound+Super+Nintendo+Entertainment+System&type=prices");
  });
  it("percent-encodes characters that would break the query", () => {
    const url = buildPriceChartingSearchUrl("Mega Man X & Y", "Sega Genesis");
    expect(url).toBe("https://www.pricecharting.com/search-products?q=Mega+Man+X+%26+Y+Sega+Genesis&type=prices");
    expect(new URL(url).searchParams.get("q")).toBe("Mega Man X & Y Sega Genesis");
  });
  it("keeps accents and colons intact through a round trip", () => {
    const url = buildPriceChartingSearchUrl("Pokémon Red: Version", "Game Boy");
    expect(new URL(url).searchParams.get("q")).toBe("Pokémon Red: Version Game Boy");
    expect(new URL(url).searchParams.get("type")).toBe("prices");
  });
});

describe("buildEbaySearchUrl", () => {
  it("builds an active-listing search", () => {
    expect(buildEbaySearchUrl("Chrono Trigger", "SNES")).toBe("https://www.ebay.com/sch/i.html?_nkw=Chrono+Trigger+SNES");
  });
  it("works without a platform", () => {
    expect(buildEbaySearchUrl("Chrono Trigger")).toBe("https://www.ebay.com/sch/i.html?_nkw=Chrono+Trigger");
  });
});

describe("buildEbaySoldSearchUrl", () => {
  it("is the active search plus the sold filter eBay's own UI emits", () => {
    const name = "Chrono Trigger";
    const platform = "SNES";
    expect(buildEbaySoldSearchUrl(name, platform)).toBe(`${buildEbaySearchUrl(name, platform)}&LH_Sold=1&LH_Complete=1`);
    const params = new URL(buildEbaySoldSearchUrl(name, platform)).searchParams;
    expect(params.get("LH_Sold")).toBe("1");
    expect(params.get("LH_Complete")).toBe("1");
  });
});

describe("platformSearchTerms", () => {
  it("gives PriceCharting the full name and eBay the short one", () => {
    // eBay keyword search is conjunctive: no listing title says "Super
    // Nintendo Entertainment System", they all say "SNES".
    expect(platformSearchTerms("snes", "SNES")).toEqual({ priceChartingTerm: "Super Nintendo Entertainment System", ebayTerm: "SNES" });
    expect(platformSearchTerms("ps1", "PS1")).toEqual({ priceChartingTerm: "PlayStation", ebayTerm: "PS1" });
  });
  it("falls back to the caller's label for a slug we do not know", () => {
    expect(platformSearchTerms("jaguar", "Jaguar")).toEqual({ priceChartingTerm: "Jaguar", ebayTerm: "Jaguar" });
    expect(platformSearchTerms("", "")).toEqual({ priceChartingTerm: "", ebayTerm: "" });
  });
});
