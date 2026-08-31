import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { BackLink } from "@/components/game/back-link";
import { Screenshots } from "@/components/game/screenshots";
import { CodeList } from "@/components/game/code-list";
import { MapCards } from "@/components/game/map-cards";
import { ManualCards } from "@/components/game/manual-cards";
import { Bookmarks } from "@/components/game/bookmarks";
import { Journal } from "@/components/game/journal";
import { PlayHistory } from "@/components/game/play-history";
import { TagEditor } from "@/components/game/tag-editor";
import { Cover } from "@/components/shelf/cover";
import { minutesLabel } from "@/components/shelf/players-line";
import { Badge, cx } from "@/components/ui";
import { loadGame, type ShelfCopy } from "@/lib/collection";
import type { Fact, PlayerProfile } from "@/lib/facts";
import { buildEbaySearchUrl, buildEbaySoldSearchUrl, buildPriceChartingSearchUrl } from "@/lib/links";

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
  if (!game) notFound();
  const owned = game.similarGames.filter((s) => s.ownedId);
  const notOwned = game.similarGames.filter((s) => !s.ownedId);
  // One list: IGDB's picks first (red ring), then tag-overlap picks to fill it out.
  const onShelf = [
    ...owned.map((s) => ({ id: s.ownedId!, name: s.name, cover: s.cover, platformLabel: s.platformLabel, why: "igdb" as const })),
    ...game.related.map((r) => ({ id: r.id, name: r.name, cover: r.cover, platformLabel: r.copies.map((c) => c.platformLabel).join(" · "), why: "tags" as const })),
  ].slice(0, 12);
  return (
    <div className="mx-auto max-w-6xl px-4 pb-safe">
      <div className="flex items-center justify-between py-2">
        <BackLink />
        <Link href="/" className="font-display text-sm font-bold text-muted hover:text-text">
          <span className="text-accent">▮</span> Game Explorer
        </Link>
      </div>

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

          {/* Should we play this? */}
          <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3" data-testid="facts">
            <FactTile label="Players" fact={game.profile.maxPlayers} render={(v) => (v <= 1 ? "1" : `1–${v}`)} fallback={game.players.tier === "mode" ? game.players.label : null} />
            <FactTile label="Co-op" fact={game.profile.coop} render={(v) => (v ? "Yes" : "No")} />
            <FactTile label="At the same time" fact={game.profile.simultaneousPlay} render={(v) => (v ? "Yes" : "Turns")} />
            <FactTile label="How long" fact={game.profile.playtimeMinutes} render={(v) => minutesLabel(v) ?? "?"} sub={game.playtimeRange.completely ? `${minutesLabel(game.playtimeRange.completely)} to finish everything` : null} />
            <FactTile label="Rating" fact={game.rating != null ? { value: game.rating, source: "igdb:game_modes" } : { value: null, source: null }} render={(v) => `${v}`} sub={game.ratingCount ? `${game.ratingCount} votes on IGDB` : null} hideSource />
            <div className="rounded-xl border border-border bg-surface p-3">
              <div className="text-xs text-muted">Plays like</div>
              <div className="mt-1 flex flex-wrap gap-1">
                {game.tags
                  .filter((t) => t.source !== "igdb" || game.genres.includes(t.tag) || game.perspectives.includes(t.tag))
                  .slice(0, 4)
                  .map((t) => (
                    <Badge key={t.key} tone={t.source === "manual" ? "good" : t.source === "agent" ? "info" : "muted"}>
                      {t.tag}
                    </Badge>
                  ))}
                {!game.tags.length ? <span className="text-faint">?</span> : null}
              </div>
            </div>
          </div>

          {game.summary ? <p className="mt-5 max-w-prose text-[15px] leading-relaxed text-text/90">{game.summary}</p> : <p className="mt-5 text-sm text-faint">No description in the catalog{game.igdbId ? "" : " — this cartridge is not linked to IGDB yet"}.</p>}
          <TagEditor gameId={id} tags={game.tags} hidden={game.hiddenTags} />
        </div>
      </div>

      {/* Directly after the tags: this is the part of the page that is about
          you, and the thing you came here to tap. */}
      <PlayHistory gameId={id} sessions={game.sessions} queued={game.queued} />

      <MapCards gameId={id} maps={game.maps} />

      <CodeList gameId={id} codes={game.codes} />

      <ManualCards gameId={id} manuals={game.manuals} />

      {/* Reference material sits with the codes and maps: it is the same kind
          of thing — impersonal, the same for every owner, and agent-fillable. */}
      <Bookmarks gameId={id} bookmarks={game.bookmarks} />

      {game.screenshots.length ? (
        <section className="mt-8">
          <h2 className="mb-3 font-display text-base font-bold">What it looks like</h2>
          <Screenshots shots={game.screenshots} title={game.name} />
        </section>
      ) : null}

      <section className="mt-8">
        <h2 className="mb-3 font-display text-base font-bold">
          Similar, and on the shelf {onShelf.length ? <span className="text-muted">· {onShelf.length}</span> : null}
        </h2>
        {onShelf.length ? (
          <div className="grid grid-cols-3 gap-3 sm:grid-cols-[repeat(auto-fill,minmax(120px,1fr))]" data-testid="similar-owned">
            {onShelf.map((s) => (
              <Link key={s.id} href={`/game/${s.id}`} className="group" prefetch={false}>
                <Cover imageId={s.cover} title={s.name} className={cx("transition group-hover:-translate-y-1", s.why === "igdb" && "ring-2 ring-accent/70")} />
                <div className="mt-1.5 line-clamp-2 text-xs font-medium">{s.name}</div>
                <div className="text-[11px] text-muted">{s.platformLabel}</div>
              </Link>
            ))}
          </div>
        ) : (
          <p className="text-sm text-faint">Nothing on the shelf looks similar yet — tags would help here.</p>
        )}
        {notOwned.length ? (
          <details className="mt-4 group">
            <summary className="cursor-pointer text-sm text-muted hover:text-text">Similar, not owned · {notOwned.length}</summary>
            <div className="mt-3 grid grid-cols-4 gap-2 opacity-60 sm:grid-cols-[repeat(auto-fill,minmax(90px,1fr))]" data-testid="similar-not-owned">
              {notOwned.map((s) => (
                <div key={s.igdbId}>
                  <Cover imageId={s.cover} title={s.name} size="small" />
                  <div className="mt-1 line-clamp-2 text-[11px]">{s.name}</div>
                </div>
              ))}
            </div>
          </details>
        ) : null}
      </section>

      <LookupLinks name={game.name} copies={game.copies} />

      {/* Last on the page: the journal is the one section that grows without bound. */}
      <Journal gameId={id} entries={game.journal} sessions={game.sessions} />

      <footer className="mt-10 border-t border-border/60 py-4 text-xs text-faint">
        {game.igdbId ? (
          <>
            IGDB #{game.igdbId} · matched {game.matchSource ?? "?"}
            {game.matchConfidence != null ? ` at ${Math.round(game.matchConfidence * 100)}%` : ""}
          </>
        ) : (
          "Not linked to a catalog entry."
        )}
        {game.completeness ? ` · ${game.completeness}` : ""}
        {game.condition ? ` · condition ${game.condition}` : ""}
        {game.notes ? ` · ${game.notes}` : ""}
      </footer>
    </div>
  );
}

/**
 * Price lookups, at the bottom of the page on purpose: this answers "what is
 * this worth", not "should we play it". Pure link-outs — no price is fetched,
 * shown or stored here (that stays game-manage's job). The platform rides
 * along in the query, because "EarthBound" alone buries the cartridge under
 * the Wii U re-release — and both sites want the short spelling, which is
 * exactly the shelf's `platformLabel` ("SNES", not the full console name).
 *
 * One row per platform the game is owned on, since a grouped game can be more
 * than one copy and each is worth a different amount. The three link texts
 * repeat down those rows, so each anchor names its platform in an aria-label —
 * "PriceCharting" on its own tells a screen reader nothing about which copy.
 */
function LookupLinks({ name, copies }: { name: string; copies: ShelfCopy[] }) {
  return (
    <section className="mt-8" data-testid="lookup-links">
      <h2 className="mb-3 font-display text-base font-bold">What is it worth?</h2>
      <div className="flex flex-col gap-3">
        {copies.map((c) => (
          <div key={c.ownedId} className="flex flex-wrap items-center gap-2">
            {copies.length > 1 ? <span className="w-full text-xs text-muted sm:w-24 sm:shrink-0">{c.platformLabel}</span> : null}
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
        ))}
      </div>
      <p className="mt-2 text-xs text-faint">Searches their site in a new tab. Nothing is fetched or saved here.</p>
    </section>
  );
}

function OutboundLink({ href, label, children }: { href: string; label: string; children: ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noreferrer" aria-label={label} className="inline-flex min-h-11 items-center gap-1.5 rounded-xl border border-border bg-surface px-4 text-sm transition hover:border-muted hover:bg-surface-2" data-testid="lookup-link">
      {children}
      <span aria-hidden className="text-faint">↗</span>
    </a>
  );
}

const sourceLabel: Record<string, { text: string; tone: "good" | "muted" | "info" | "warn" }> = {
  manual: { text: "verified", tone: "good" },
  agent: { text: "researched", tone: "good" },
  "igdb:multiplayer_modes": { text: "IGDB", tone: "muted" },
  "igdb:game_modes": { text: "IGDB", tone: "muted" },
  "igdb:time_to_beat": { text: "IGDB", tone: "muted" },
  derived: { text: "inferred", tone: "info" },
};

function FactTile<T extends number | boolean>({ label, fact, render, fallback, sub, hideSource }: { label: string; fact: Fact<T> | PlayerProfile[keyof PlayerProfile]; render: (v: T) => string; fallback?: string | null; sub?: string | null; hideSource?: boolean }) {
  const known = fact.value != null;
  const src = fact.source ? sourceLabel[fact.source] : null;
  return (
    <div className={cx("rounded-xl border p-3", known ? "border-border bg-surface" : "border-dashed border-border bg-transparent")}>
      <div className="flex items-center justify-between gap-2 text-xs text-muted">
        <span>{label}</span>
        {known && src && !hideSource ? (
          "sourceUrl" in fact && fact.sourceUrl ? (
            <a href={fact.sourceUrl} target="_blank" rel="noreferrer" title={fact.sourceUrl} className="hover:underline">
              <Badge tone={src.tone}>{src.text} ↗</Badge>
            </a>
          ) : (
            <Badge tone={src.tone}>{src.text}</Badge>
          )
        ) : null}
      </div>
      <div className={cx("mt-1 font-display text-xl font-bold", !known && "text-faint")} title={fact.value != null && "note" in fact && fact.note ? fact.note : undefined}>
        {known ? render(fact.value as T) : (fallback ?? "?")}
      </div>
      {sub && known ? <div className="text-[11px] text-faint">{sub}</div> : null}
      {!known && !fallback ? <div className="text-[11px] text-faint">unknown</div> : null}
    </div>
  );
}
