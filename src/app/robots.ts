import type { MetadataRoute } from "next";

/**
 * The collection is public to anyone with the link and to nobody else: friends
 * and family, not search results. `Disallow: /` here, `metadata.robots` in the
 * root layout, and `X-Robots-Tag: noindex` from `src/proxy.ts` — three places
 * because a crawler only has to honour one of them.
 */
export default function robots(): MetadataRoute.Robots {
  return { rules: [{ userAgent: "*", disallow: "/" }] };
}
