/**
 * Outbound lookup links for a game — PriceCharting and eBay.
 *
 * Link-outs only, by design: the app stores no prices, fetches nothing, and
 * tracks no value over time (that is `game-manage`'s job). These are pure URL
 * builders; the game page renders them as anchors.
 *
 * The platform belongs in the query — "EarthBound" alone drags in the Wii U
 * re-release — and both sites want the short spelling of it (the shelf's
 * `platformLabel`, e.g. "SNES"). eBay keyword search is conjunctive: every
 * word must appear in the listing title, and sellers write "SNES", never
 * "Super Nintendo Entertainment System". PriceCharting behaves the same way in
 * practice — the full name returns "not found" for titles the short name finds
 * outright ("Legacy of the Wizard NES" lands on the game's own page).
 */

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
