import Link from "next/link";
import { notFound } from "next/navigation";
import { SiteHeader } from "@/components/site-header";
import { SeriesEditor, type EditorEntry } from "@/components/series/series-editor";
import { prisma } from "@/lib/db";
import { seriesBySlug } from "@/lib/series/service";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props) {
  const s = await seriesBySlug((await params).slug);
  return { title: s ? `Editing ${s.name}` : "Series" };
}

/**
 * Editing one series (GAMEEXPLOR-0020) — the curation half of `/series/[slug]`.
 *
 * Owner-only as a *page*: `/series/:slug/edit` is in `OWNER_PAGES` in
 * `src/proxy.ts`, so a signed-out visitor is redirected to `/login` before
 * anything here runs. That is the fence; the "Edit" control on the series page
 * is only a courtesy, and this file deliberately does not check credentials
 * itself — nothing under the app should, per the invariant.
 *
 * Two reads, for two different things. `seriesBySlug` resolves each entry the
 * way the series page does — the catalog cover, the year, and which copy on
 * the shelf backs it — so a row here is recognisable as the same row you saw
 * there. The raw query beside it is for the columns the *editor* needs and the
 * view model does not carry: `Series.coverImageId` (the view exposes only the
 * derived `cover`, override or first entry) and `SeriesEntry.title` (the view
 * exposes only the resolved `name`, so an empty override is indistinguishable
 * from one that happens to match). Editing a field you were shown a fallback
 * for would write the fallback back into the row.
 */
export default async function EditSeriesPage({ params }: Props) {
  const { slug } = await params;
  const view = await seriesBySlug(slug);
  if (!view) notFound();
  const row = await prisma.series.findUnique({
    where: { id: view.id },
    select: { id: true, name: true, slug: true, blurb: true, coverImageId: true, position: true, seedCollectionId: true, seedCheckedAt: true, entries: { select: { id: true, title: true } } },
  });
  if (!row) notFound();

  const overrides = new Map(row.entries.map((e) => [e.id, e.title]));
  // `view.entries` is already in `position` order — the whole list, unfiltered,
  // which is what makes the editor's reorder a valid full permutation.
  const entries: EditorEntry[] = view.entries.map((e) => ({
    id: e.id,
    igdbId: e.igdbId,
    name: e.name,
    title: overrides.get(e.id) ?? "",
    cover: e.cover,
    year: e.year,
    section: e.section ?? "",
    note: e.note ?? "",
    sourceUrl: e.sourceUrl ?? "",
    ownedId: e.ownedId,
    platformLabel: e.platformLabel,
  }));

  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-3xl px-4 pb-24">
        <Link href={`/series/${row.slug}`} className="mt-4 inline-flex min-h-11 items-center text-sm text-muted hover:text-text" prefetch={false}>
          ← {row.name}
        </Link>
        <h1 className="mb-5 mt-1 font-display text-2xl font-bold tracking-tight sm:text-3xl">Editing {row.name}</h1>
        <SeriesEditor
          series={{
            id: row.id,
            name: row.name,
            slug: row.slug,
            blurb: row.blurb ?? "",
            coverImageId: row.coverImageId ?? "",
            position: row.position,
            seedCollectionId: row.seedCollectionId,
            // A string rather than the Date: the editor only ever prints it,
            // and `day()` takes either.
            seedCheckedAt: row.seedCheckedAt?.toISOString() ?? null,
          }}
          entries={entries}
        />
      </main>
    </>
  );
}
