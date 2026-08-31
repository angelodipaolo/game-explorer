import Link from "next/link";
import { notFound } from "next/navigation";
import { SiteHeader } from "@/components/site-header";
import { BackLink } from "@/components/game/back-link";
import { Section } from "@/components/game/section";
import { SectionNav, type NavSection } from "@/components/game/section-nav";
import { Screenshots } from "@/components/game/screenshots";
import { CodeList } from "@/components/game/code-list";
import { MapCards } from "@/components/game/map-cards";
import { ManualCards } from "@/components/game/manual-cards";
import { Bookmarks } from "@/components/game/bookmarks";
import { Journal } from "@/components/game/journal";
import { PlayControls } from "@/components/game/play-controls";
import { PlayHistory } from "@/components/game/play-history";
import { PlayLine } from "@/components/game/play-line";
import { SimilarShelf } from "@/components/game/similar-shelf";
import { ThisCopy } from "@/components/game/this-copy";
import { TagEditor } from "@/components/game/tag-editor";
import { Cover } from "@/components/shelf/cover";
import { Badge } from "@/components/ui";
import { loadGame } from "@/lib/collection";
import { readViewer } from "@/lib/viewer";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const game = await loadGame((await params).id);
  return { title: game?.name ?? "Game" };
}

export default async function GamePage({ params }: { params: Promise<{ id: string }> }) {
  // The route id is the copy you opened; `game.id` is the *primary* copy of the
  // grouped entry (`groupShelf` sets it to `copies[0].ownedId`). They differ on
  // a multi-platform game opened at a non-primary copy — exactly what a
  // `/playing` row links to. Everything per-copy below therefore takes `id`:
  // `loadGame` reads codes, maps, runs, journal and the queue entry for `id`,
  // so a write addressed to `game.id` would land on a different cartridge —
  // and a journal entry filed under this copy's open run would be rejected
  // ("session belongs to a different game").
  const { id } = await params;
  const game = await loadGame(id);
  // Read-only for a visitor: the tags, codes, runs, journal and links are all
  // still here, only the controls that write them are not (GAMEEXPLOR-0002).
  const { canEdit } = await readViewer();
  if (!game) notFound();
  const owned = game.similarGames.filter((s) => s.ownedId);
  const notOwned = game.similarGames.filter((s) => !s.ownedId);
  // One list: IGDB's picks first (red ring), then tag-overlap picks to fill it out.
  const onShelf = [
    ...owned.map((s) => ({ id: s.ownedId!, name: s.name, cover: s.cover, platformLabel: s.platformLabel, why: "igdb" as const })),
    ...game.related.map((r) => ({ id: r.id, name: r.name, cover: r.cover, platformLabel: r.copies.map((c) => c.platformLabel).join(" · "), why: "tags" as const })),
  ].slice(0, 12);

  const runOpen = game.sessions.some((s) => !s.endedAt);

  // The jump bar (step 7) only lists what actually exists on this game — no
  // maps on the shelf yet means no "Maps" chip.
  const navSections: NavSection[] = [
    { id: "play", label: "Play" },
    game.screenshots.length ? { id: "screens", label: "Screens" } : null,
    game.maps.length ? { id: "maps", label: "Maps" } : null,
    { id: "codes", label: "Codes" },
    game.manuals.length ? { id: "manual", label: "Manual" } : null,
    { id: "guides", label: "Guides" },
    { id: "journal", label: "Journal" },
    { id: "similar", label: "Similar" },
    { id: "copy", label: "Copy" },
  ].filter((s): s is NavSection => s != null);

  return (
    <>
      {/* The main menu belongs here too (GAMEEXPLOR-0018): a game page is where
          you land from a shared link, and it used to be a dead end with one way
          back. The wordmark in the header is home, so the standalone "Game
          Explorer" link that sat opposite the back-link is gone; the back-link
          stays, because "back to the shelf you were looking at" is not "home". */}
      <SiteHeader />
      <div className="mx-auto max-w-6xl px-4 pb-safe">
        <div className="flex items-center py-2">
          <BackLink />
        </div>

        {/* The top of the page is the decision, in about one screen: cover,
            title, the play line, the primary action, the description and
            tags. Everything below is drawers grouped by moment — help me
            while playing, this is mine — quiet when empty (GAMEEXPLOR-0023). */}
        <div className="grid gap-6 sm:grid-cols-[minmax(0,260px)_1fr] sm:gap-10 lg:grid-cols-[minmax(0,320px)_1fr]">
          <div className="mx-auto w-[60%] max-w-xs sm:mx-0 sm:w-full">
            <Cover imageId={game.cover} title={game.name} size="huge" priority className="shadow-2xl shadow-black/60 ring-1 ring-white/10" />
          </div>

          <div>
            <div className="flex flex-wrap items-center gap-2 text-sm text-muted">
              {game.copies.map((c) => (
                <Badge key={c.platform}>
                  {c.platformLabel}
                  {c.quantity > 1 ? ` ×${c.quantity}` : ""}
                </Badge>
              ))}
              {game.year ? <span>{game.year}</span> : null}
              {game.developers[0] ? <span>· {game.developers[0]}</span> : null}
              {/* Rating demoted from its own tile (step 2) into a chip here —
                  it reads faster beside the platform and year than as a
                  fourth thing to scan below. */}
              {game.rating != null ? <Badge tone="accent" title={game.ratingCount ? `${game.ratingCount} votes on IGDB` : "IGDB rating"}>★{game.rating}</Badge> : null}
            </div>
            <h1 className="mt-2 font-display text-3xl font-bold leading-tight tracking-tight sm:text-4xl" data-testid="game-title">
              {game.name}
            </h1>
            {game.title !== game.name ? <p className="mt-1 text-sm text-faint">on the shelf as &ldquo;{game.title}&rdquo;</p> : null}

            {/* Cheap, and it is how the feature gets discovered: from a game you
                are already looking at, into the list of what else is in its
                series and what of it you are missing. */}
            {game.series.length ? (
              <div className="mt-2 flex flex-wrap items-center gap-2 text-sm" data-testid="game-series">
                {game.series.map((s) => (
                  <Link key={s.id} href={`/series/${s.slug}`} className="inline-flex min-h-9 items-center rounded-lg border border-border bg-surface px-3 text-muted transition hover:border-muted hover:text-text" prefetch={false}>
                    Part of {s.name} <span aria-hidden className="ml-1 text-accent-2">→</span>
                  </Link>
                ))}
              </div>
            ) : null}

            {/* Should we play this? Six fact tiles condensed into one line
                (step 2), with the same facts one tap away underneath. */}
            <PlayLine profile={game.profile} playersFallback={game.players} playtimeCompletely={game.playtimeRange.completely} />

            {/* The button the app exists for, moved above the fold (step 3) —
                it used to sit ~2,000px down inside Play History. */}
            <PlayControls gameId={id} sessions={game.sessions} queued={game.queued} canEdit={canEdit} />

            {game.summary ? <p className="mt-5 max-w-prose text-[15px] leading-relaxed text-text/90">{game.summary}</p> : <p className="mt-5 text-sm text-faint">No description in the catalog{game.igdbId ? "" : " — this cartridge is not linked to IGDB yet"}.</p>}
            <TagEditor gameId={id} tags={game.tags} hidden={game.hiddenTags} canEdit={canEdit} />
          </div>
        </div>

        {/* Where the jump bar (step 7) starts watching: once this scrolls out
            of view, the bar sticks under the site header. */}
        <SectionNav sections={navSections} />

        {/* "What it looks like" (step 4): the second half of the decision, so
            it moves up here from 72% down the page — directly after the
            description and tag row, before Play history. */}
        {game.screenshots.length ? (
          <Section id="screens" title="What it looks like" testId="screenshots">
            <Screenshots shots={game.screenshots} title={game.name} />
          </Section>
        ) : null}

        <PlayHistory gameId={id} sessions={game.sessions} canEdit={canEdit} />

        <MapCards gameId={id} maps={game.maps} />

        {/* Collapsed by default; forced open while a run is in progress —
            codes are why the phone came out (step 5). */}
        <CodeList gameId={id} codes={game.codes} canEdit={canEdit} forceOpen={runOpen} />

        <ManualCards gameId={id} manuals={game.manuals} />

        {/* Reference material sits with the codes and maps: it is the same kind
            of thing — impersonal, the same for every owner, and agent-fillable. */}
        <Bookmarks gameId={id} bookmarks={game.bookmarks} canEdit={canEdit} />

        {/* Last on the page before "Similar" and "This copy": the journal is
            the one section that grows without bound. */}
        <Journal gameId={id} entries={game.journal} sessions={game.sessions} canEdit={canEdit} />

        {/* Moved to the last content section (step 5) — "what else is like
            this" is the natural next question once you have read everything
            else, not the first one. */}
        <SimilarShelf onShelf={onShelf} notOwned={notOwned} />

        {/* The price links and the old footer's IGDB line, merged into one
            closing section (step 6) — it was the only part of the page not
            about playing, which is why it read as an orphan on its own. */}
        <ThisCopy name={game.name} copies={game.copyDetails} />
      </div>
    </>
  );
}
