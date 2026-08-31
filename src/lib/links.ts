/**
 * Outbound lookup links for a game — PriceCharting and eBay.
 *
 * Link-outs only, by design: the app stores no prices, fetches nothing, and
 * tracks no value over time (that is `game-manage`'s job). These are pure URL
 * builders; the game page renders them as anchors.
 *
 * The platform belongs in the query — "EarthBound" alone drags in the Wii U
 * re-release — but the two sites want different spellings of it, which is what
 * `platformSearchTerms` resolves:
 *
 * - PriceCharting matches fuzzily, so the full name ("Super Nintendo
 *   Entertainment System") disambiguates without costing results.
 * - eBay keyword search is conjunctive: every word must appear in the listing
 *   title. "Super Nintendo Entertainment System" can return nothing at all,
 *   because sellers write "SNES". So eBay gets the short name.
 */

import { platformBySlug } from "./platforms";

const PRICECHARTING_SEARCH = "https://www.pricecharting.com/search-products";
const EBAY_SEARCH = "https://www.ebay.com/sch/i.html";

/** The search phrase both sites get: the game name, plus the platform when known. */
export function searchTerm(name: string, platform?: string | null): string {
  return [name, platform]
    .map((part) => (part ?? "").trim())
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ");
}

/**
 * The platform words each site should get, from an `OwnedGame.platform` slug.
 * An unrecognised slug has no long/short split to make, so both fall back to
 * the label the caller already displays.
 */
export function platformSearchTerms(slug: string, fallbackLabel: string): { priceChartingTerm: string; ebayTerm: string } {
  const platform = platformBySlug(slug);
  if (!platform) return { priceChartingTerm: fallbackLabel, ebayTerm: fallbackLabel };
  return { priceChartingTerm: platform.name, ebayTerm: platform.short };
}

/** PriceCharting's product search, on the prices tab (loose / CIB / new columns). */
export function buildPriceChartingSearchUrl(name: string, platform?: string | null): string {
  const params = new URLSearchParams({ q: searchTerm(name, platform), type: "prices" });
  return `${PRICECHARTING_SEARCH}?${params.toString()}`;
}

/** eBay's active listings — what someone is asking for it right now. */
export function buildEbaySearchUrl(name: string, platform?: string | null): string {
  const params = new URLSearchParams({ _nkw: searchTerm(name, platform) });
  return `${EBAY_SEARCH}?${params.toString()}`;
}

/**
 * eBay's completed sales — what it actually went for, which is the useful
 * number. `LH_Sold=1&LH_Complete=1` is the pair eBay's own UI emits; sold
 * without complete is not a form the site guarantees.
 */
export function buildEbaySoldSearchUrl(name: string, platform?: string | null): string {
  const params = new URLSearchParams({ _nkw: searchTerm(name, platform), LH_Sold: "1", LH_Complete: "1" });
  return `${EBAY_SEARCH}?${params.toString()}`;
}
