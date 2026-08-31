import Link from "next/link";
import { SiteHeader } from "@/components/site-header";
import { Cover } from "@/components/shelf/cover";
import { LinkButton } from "@/components/ui";
import { listSeries } from "@/lib/series/service";
import { readViewer } from "@/lib/viewer";

export const dynamic = "force-dynamic";
export const metadata = { title: "Series" };

/**
 * The index: one card per series, sorted by `position` then name.
 *
 * The cover is derived from the first entry that has art rather than uploaded
 * — a series is its games, and deriving is free. `coverImageId` on the row
 * overrides it when a derived cover picks something odd; there is deliberately
 * no upload path for it.
 *
 * "7 of 16" is the whole point of the card: what you have against what exists.
 */
export default async function SeriesIndexPage() {
  const [series, { canEdit }] = await Promise.all([listSeries(), readViewer()]);
  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-5xl px-4 pb-16">
        <div className="mt-5 flex items-end justify-between gap-3">
          <div>
            <h1 className="font-display text-2xl font-bold tracking-tight sm:text-3xl">Series</h1>
            <p className="mt-1 text-sm text-muted">Every Final Fantasy, every Mario Party — and which ones are on the shelf.</p>
          </div>
          {/* Building a series is curation: /series/new is behind auth, so a
              visitor gets no button that only leads to a login page. */}
          {canEdit ? (
            <LinkButton href="/series/new" variant="primary" data-testid="new-series">
              + Series
            </LinkButton>
          ) : null}
        </div>

        {series.length ? (
          <ul className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4" data-testid="series-list">
            {series.map((s) => (
              <li key={s.id}>
                <Link href={`/series/${s.slug}`} className="group block" prefetch={false} data-testid="series-card">
                  <Cover imageId={s.cover} title={s.name} className="transition group-hover:-translate-y-1" />
                  <div className="mt-2 font-display text-sm font-bold leading-tight">{s.name}</div>
                  <div className="text-xs text-muted tabular-nums" data-testid="series-count">
                    {s.owned} of {s.total} owned
                  </div>
                  {s.blurb ? <div className="mt-0.5 line-clamp-2 text-xs text-faint">{s.blurb}</div> : null}
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-8 rounded-xl border border-dashed border-border px-4 py-10 text-center text-sm text-muted" data-testid="series-empty">
            {canEdit ? (
              <>
                No series yet. Start one from a game you own —{" "}
                <Link href="/series/new" className="text-accent-2 underline">
                  seed it from IGDB and prune
                </Link>
                .
              </>
            ) : (
              "No series yet."
            )}
          </p>
        )}
      </main>
    </>
  );
}
