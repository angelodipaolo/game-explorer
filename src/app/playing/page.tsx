import Link from "next/link";
import { SiteHeader } from "@/components/site-header";
import { Cover } from "@/components/shelf/cover";
import { QueueList } from "@/components/playing/queue-list";
import { day } from "@/components/ui";
import { loadPlaying } from "@/lib/collection";

export const dynamic = "force-dynamic";
export const metadata = { title: "Now playing" };

/**
 * What you are in the middle of, and what is next. Two lists that are disjoint
 * by construction: starting a run removes the copy from the queue in the same
 * transaction, so a game is never in both.
 */
export default async function PlayingPage() {
  const { inProgress, upNext } = await loadPlaying();
  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-3xl px-4 pb-16">
        <h1 className="mt-5 font-display text-2xl font-bold tracking-tight sm:text-3xl">Now playing</h1>

        <section className="mt-5">
          <h2 className="mb-3 font-display text-base font-bold">
            In progress {inProgress.length ? <span className="text-muted">· {inProgress.length}</span> : null}
          </h2>
          {inProgress.length ? (
            <ul className="flex flex-col gap-2" data-testid="in-progress">
              {inProgress.map((r) => (
                <li key={r.sessionId}>
                  <Link href={`/game/${r.ownedGameId}`} className="flex items-center gap-3 rounded-xl border border-accent/40 bg-accent/5 p-2 transition hover:border-accent" prefetch={false} data-testid="playing-row">
                    <Cover imageId={r.cover} title={r.name} size="small" className="w-12 shrink-0 rounded-md" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold">{r.name}</span>
                      <span className="block truncate text-xs text-muted">
                        {r.platformLabel} · since {day(r.startedAt)}
                      </span>
                      {/* Where you left off: the last thing written during this run, else the run's own note. */}
                      {r.lastEntry || r.note ? <span className="mt-0.5 block truncate text-xs text-faint">{r.lastEntry ? (r.lastEntry.body ?? r.lastEntry.title ?? "") : r.note}</span> : null}
                    </span>
                    <span className="shrink-0 text-xs text-accent" aria-hidden>
                      ▶
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="rounded-xl border border-dashed border-border px-4 py-6 text-center text-sm text-muted" data-testid="in-progress-empty">
              Nothing on the go.{" "}
              <Link href="/shelf?play=never" className="text-accent-2 underline">
                Find something you have never played
              </Link>
              .
            </p>
          )}
        </section>

        <section className="mt-8">
          <h2 className="mb-3 font-display text-base font-bold">
            Up next {upNext.length ? <span className="text-muted">· {upNext.length}</span> : null}
          </h2>
          {upNext.length ? (
            <QueueList rows={upNext} />
          ) : (
            <p className="rounded-xl border border-dashed border-border px-4 py-6 text-center text-sm text-muted" data-testid="queue-empty">
              The queue is empty. Open a game and tap <span className="text-text">Add to queue</span> —{" "}
              <Link href="/shelf" className="text-accent-2 underline">
                back to the shelf
              </Link>
              .
            </p>
          )}
        </section>
      </main>
    </>
  );
}
