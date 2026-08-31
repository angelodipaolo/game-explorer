import Link from "next/link";
import { notFound } from "next/navigation";
import { SiteHeader } from "@/components/site-header";
import { Cover } from "@/components/shelf/cover";
import { Badge, cx } from "@/components/ui";
import { missingHref, parseMissing } from "@/lib/series/shape";
import { seriesBySlug, type SeriesEntryView } from "@/lib/series/service";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ slug: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

export async function generateMetadata({ params }: Props) {
  const s = await seriesBySlug((await params).slug);
  return { title: s?.name ?? "Series" };
}

/**
 * One series, **defaulting to the games you own**.
 *
 * That default matters: this is a collection browser first, and a page that
 * opens mostly greyed out reads as a shopping list. What is missing is
 * something you ask for — `?missing=1` — and because it is in the URL the
 * "what am I missing" view is a link you can send yourself at the shop.
 *
 * The toggle is a page-level searchParam, not part of `Filters` in
 * src/lib/filters.ts: the shelf's filter state has nothing to do with it, and
 * this page is rendered per URL on the server rather than filtered in the
 * browser.
 */
export default async function SeriesPage({ params, searchParams }: Props) {
  const { slug } = await params;
  const series = await seriesBySlug(slug);
  if (!series) notFound();
  const missing = parseMissing(await searchParams);
  const sections = series.sections.map((g) => ({ ...g, entries: missing ? g.entries : g.entries.filter((e) => e.ownedId) })).filter((g) => g.entries.length);
  const shown = sections.reduce((n, g) => n + g.entries.length, 0);
  const named = sections.some((g) => g.section);

  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-3xl px-4 pb-16">
        <Link href="/series" className="mt-4 inline-flex min-h-11 items-center text-sm text-muted hover:text-text">
          ← All series
        </Link>
        <h1 className="mt-1 font-display text-2xl font-bold tracking-tight sm:text-3xl" data-testid="series-title">
          {series.name}
        </h1>
        {series.blurb ? <p className="mt-1 max-w-prose text-sm text-muted">{series.blurb}</p> : null}

        {/* The count line IS the control — one tap, thumb-sized, and it changes
            the URL rather than some hidden state. An empty series has nothing to
            reveal, so it gets no control at all rather than "0 of 0". */}
        {series.total ? (
          <Link
            href={missingHref(series.slug, !missing)}
            prefetch={false}
            scroll={false}
            className="mt-4 inline-flex min-h-11 items-center gap-2 rounded-xl border border-border bg-surface px-4 text-sm transition hover:border-muted"
            data-testid="missing-toggle"
          >
            <span className="tabular-nums">
              You own <span className="font-semibold text-text">{series.owned}</span> of {series.total}
            </span>
            <span className="text-accent-2 underline">{missing ? "hide what I'm missing" : "show what I'm missing"}</span>
          </Link>
        ) : null}

        {shown ? (
          <div className="mt-6 flex flex-col gap-6" data-testid="series-entries">
            {sections.map((group) => (
              <section key={group.section ?? "__none"}>
                {named ? <h2 className="mb-2 font-display text-sm font-bold uppercase tracking-[0.14em] text-muted">{group.section ?? "Also"}</h2> : null}
                <ul className="flex flex-col gap-2">
                  {group.entries.map((e) => (
                    <li key={e.id}>
                      <EntryRow entry={e} />
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        ) : series.total ? (
          <p className="mt-8 rounded-xl border border-dashed border-border px-4 py-10 text-center text-sm text-muted" data-testid="series-none-owned">
            None of this series is on the shelf yet.{" "}
            <Link href={missingHref(series.slug, true)} className="text-accent-2 underline" prefetch={false}>
              Show all {series.total}
            </Link>
            .
          </p>
        ) : (
          // A series with no entries at all: "Show all 0" would link to the page
          // you are already on.
          <p className="mt-8 rounded-xl border border-dashed border-border px-4 py-10 text-center text-sm text-muted" data-testid="series-empty">
            No entries yet.
          </p>
        )}
      </main>
    </>
  );
}

/**
 * An owned entry is a link to its game page; an unowned one is the same row,
 * dimmed and marked, in its right position in the order — never a separate
 * "missing" list, because seeing the gap where V should be is the point.
 */
function EntryRow({ entry }: { entry: SeriesEntryView }) {
  const inner = (
    <>
      <span className="w-11 shrink-0">
        <Cover imageId={entry.cover} title={entry.name} size="small" className="w-full rounded-md" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold">{entry.name}</span>
        <span className="block truncate text-xs text-muted">
          {entry.year ?? "—"}
          {entry.ownedId ? ` · ${entry.platformLabel}` : ""}
          {entry.note ? ` · ${entry.note}` : ""}
        </span>
      </span>
      {entry.ownedId ? (
        <span className="shrink-0 text-xs text-accent" aria-hidden>
          ›
        </span>
      ) : (
        <Badge>not owned</Badge>
      )}
    </>
  );
  const className = cx("flex items-center gap-3 rounded-xl border p-2", entry.ownedId ? "border-border bg-surface transition hover:border-muted" : "border-dashed border-border/70 opacity-55");
  return entry.ownedId ? (
    <Link href={`/game/${entry.ownedId}`} className={className} prefetch={false} data-testid="series-entry-owned">
      {inner}
    </Link>
  ) : (
    <div className={className} data-testid="series-entry-missing">
      {inner}
    </div>
  );
}
