import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { SiteHeader } from "@/components/site-header";
import { SeriesGrid } from "@/components/series/series-grid";
import { LinkButton } from "@/components/ui";
import { parseMissing } from "@/lib/series/shape";
import { seriesBySlug } from "@/lib/series/service";
import { readViewer } from "@/lib/viewer";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ slug: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

export async function generateMetadata({ params }: Props) {
  const s = await seriesBySlug((await params).slug);
  return { title: s?.name ?? "Series" };
}

/**
 * One series, as the shelf's grid in the series' own order, **defaulting to
 * the games you own** (GAMEEXPLOR-0016).
 *
 * That default matters: this is a collection browser first, and a page that
 * opens mostly greyed out reads as a shopping list. What is missing is
 * something you ask for — `?missing=1` — and because it is in the URL the
 * "what am I missing" view is a link you can send yourself at the shop.
 *
 * The toggle stays a page-level searchParam, resolved here on the server: it
 * decides which entries are sent at all, which is not what a `Filters` field
 * does (see src/lib/series/shape.ts). Everything else — search, platform,
 * tags, players, era — is the shelf's own filter state, held in the URL by the
 * client component below, which is why this page needs the `<Suspense>`
 * boundary `useSearchParams` requires, exactly as `/shelf` does.
 */
export default async function SeriesPage({ params, searchParams }: Props) {
  const { slug } = await params;
  const [series, viewer] = await Promise.all([seriesBySlug(slug), readViewer()]);
  if (!series) notFound();
  const missing = parseMissing(await searchParams);
  const sections = series.sections.map((g) => ({ ...g, entries: missing ? g.entries : g.entries.filter((e) => e.ownedId) })).filter((g) => g.entries.length);

  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-7xl px-4 pb-16">
        <Link href="/series" className="mt-4 inline-flex min-h-11 items-center text-sm text-muted hover:text-text">
          ← All series
        </Link>
        <div className="mt-1 flex items-start justify-between gap-3">
          <h1 className="font-display text-2xl font-bold tracking-tight sm:text-3xl" data-testid="series-title">
            {series.name}
          </h1>
          {/* Curation lives on its own page (GAMEEXPLOR-0020), the way /flip is
              its own page: this one is the shelf's grid, and hanging ▲/▼/× on
              every card would turn what you look at into what you fiddle with.
              Drawn only for the owner — `/series/:slug/edit` is in OWNER_PAGES,
              so for anyone else the link would lead to a login page. */}
          {viewer.canEdit ? (
            <LinkButton href={`/series/${series.slug}/edit`} className="shrink-0" prefetch={false} data-testid="edit-series">
              Edit
            </LinkButton>
          ) : null}
        </div>
        {series.blurb ? <p className="mt-1 max-w-prose text-sm text-muted">{series.blurb}</p> : null}
        <Suspense>
          <SeriesGrid slug={series.slug} owned={series.owned} total={series.total} missing={missing} sections={sections} viewer={viewer} />
        </Suspense>
      </main>
    </>
  );
}
