import type { ReactNode } from "react";
import { Section } from "@/components/game/section";
import { buildEbaySearchUrl, buildEbaySoldSearchUrl, buildPriceChartingSearchUrl } from "@/lib/links";
import type { CopyDetail } from "@/lib/collection";

/**
 * "This copy" (step 6): the price link-outs and the footer's IGDB provenance
 * line, merged into one section that closes the page. Both used to be
 * disconnected — the only parts of the page not about *playing* — which is
 * why merging them reads as one closing note about ownership rather than two
 * orphans.
 *
 * One block per owned copy: a two-platform game gets two, each with its own
 * completeness, condition and its own three price links, exactly what the
 * old per-platform `LookupLinks` rows already implied without saying it.
 *
 * Pure link-outs — no price is fetched, shown or stored here (that stays
 * game-manage's job). The platform rides along in the query, because
 * "EarthBound" alone buries the cartridge under the Wii U re-release.
 */
export function ThisCopy({ name, copies }: { name: string; copies: CopyDetail[] }) {
  return (
    <Section id="copy" title="This copy" testId="lookup-links" collapsible defaultOpen={false} storageKey="copy">
      <div className="flex flex-col gap-3">
        {copies.map((c) => (
          <div key={c.ownedId} className="rounded-xl border border-border bg-surface p-3">
            <div className="text-sm font-medium">
              {c.platformLabel}
              {c.completeness ? ` · ${c.completeness}` : ""}
              {c.condition ? ` · condition ${c.condition}` : ""}
            </div>
            {c.notes ? <p className="mt-1 text-sm text-muted">&ldquo;{c.notes}&rdquo;</p> : null}
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <OutboundLink href={buildPriceChartingSearchUrl(name, c.platformLabel)} label={`PriceCharting — ${c.platformLabel}`}>
                PriceCharting
              </OutboundLink>
              <OutboundLink href={buildEbaySearchUrl(name, c.platformLabel)} label={`eBay — ${c.platformLabel}`}>
                eBay
              </OutboundLink>
              <OutboundLink href={buildEbaySoldSearchUrl(name, c.platformLabel)} label={`eBay sold — ${c.platformLabel}`}>
                eBay sold
              </OutboundLink>
            </div>
            <p className="mt-2 text-xs text-faint">
              {c.igdbId ? (
                <>
                  IGDB #{c.igdbId} · matched {c.matchSource ?? "?"}
                  {c.matchConfidence != null ? ` at ${Math.round(c.matchConfidence * 100)}%` : ""}
                </>
              ) : (
                "Not linked to a catalog entry."
              )}
            </p>
          </div>
        ))}
      </div>
      <p className="mt-2 text-xs text-faint">Searches their site in a new tab. Nothing is fetched or saved here.</p>
    </Section>
  );
}

function OutboundLink({ href, label, children }: { href: string; label: string; children: ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noreferrer" aria-label={label} className="inline-flex min-h-11 items-center gap-1.5 rounded-xl border border-border bg-surface px-4 text-sm transition hover:border-muted hover:bg-surface-2" data-testid="lookup-link">
      {children}
      <span aria-hidden className="text-faint">
        ↗
      </span>
    </a>
  );
}
