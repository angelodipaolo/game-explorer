import Link from "next/link";
import { notFound } from "next/navigation";
import { BackLink } from "@/components/game/back-link";
import { Screenshots } from "@/components/game/screenshots";
import { Cover } from "@/components/shelf/cover";
import { minutesLabel } from "@/components/shelf/players-line";
import { Badge, cx } from "@/components/ui";
import { loadGame } from "@/lib/collection";
import type { Fact, PlayerProfile } from "@/lib/facts";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const game = await loadGame((await params).id);
  return { title: game?.name ?? "Game" };
}

export default async function GamePage({ params }: { params: Promise<{ id: string }> }) {
  const game = await loadGame((await params).id);
  if (!game) notFound();
  const owned = game.similarGames.filter((s) => s.ownedId);
  const notOwned = game.similarGames.filter((s) => !s.ownedId);
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
            <Badge>{game.platformLabel}</Badge>
            {game.year ? <span>{game.year}</span> : null}
            {game.developers[0] ? <span>· {game.developers[0]}</span> : null}
            {game.quantity > 1 ? <Badge tone="info">×{game.quantity}</Badge> : null}
          </div>
          <h1 className="mt-2 font-display text-3xl font-bold leading-tight tracking-tight sm:text-4xl" data-testid="game-title">
            {game.name}
          </h1>
          {game.title !== game.name ? <p className="mt-1 text-sm text-faint">on the shelf as &ldquo;{game.title}&rdquo;</p> : null}

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
                {[...game.genres, ...game.perspectives].slice(0, 4).map((g) => (
                  <Badge key={g}>{g}</Badge>
                ))}
                {!game.genres.length ? <span className="text-faint">?</span> : null}
              </div>
            </div>
          </div>

          {game.summary ? <p className="mt-5 max-w-prose text-[15px] leading-relaxed text-text/90">{game.summary}</p> : <p className="mt-5 text-sm text-faint">No description in the catalog{game.igdbId ? "" : " — this cartridge is not linked to IGDB yet"}.</p>}
          {game.themes.length || game.keywords.length ? (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {[...game.themes, ...game.keywords.filter((k) => !/fan translation|hack/i.test(k)).slice(0, 6)].map((k) => (
                <span key={k} className="rounded-full bg-surface px-2.5 py-1 text-xs text-muted">
                  {k}
                </span>
              ))}
            </div>
          ) : null}
        </div>
      </div>

      {game.screenshots.length ? (
        <section className="mt-8">
          <h2 className="mb-3 font-display text-base font-bold">What it looks like</h2>
          <Screenshots shots={game.screenshots} title={game.name} />
        </section>
      ) : null}

      <section className="mt-8">
        <h2 className="mb-3 font-display text-base font-bold">
          Similar, and on the shelf {owned.length ? <span className="text-muted">· {owned.length}</span> : null}
        </h2>
        {owned.length ? (
          <div className="grid grid-cols-3 gap-3 sm:grid-cols-[repeat(auto-fill,minmax(120px,1fr))]" data-testid="similar-owned">
            {owned.map((s) => (
              <Link key={s.igdbId} href={`/game/${s.ownedId}`} className="group" prefetch={false}>
                <Cover imageId={s.cover} title={s.name} className="ring-2 ring-accent/70 transition group-hover:-translate-y-1" />
                <div className="mt-1.5 line-clamp-2 text-xs font-medium">{s.name}</div>
                <div className="text-[11px] text-muted">{s.platformLabel}</div>
              </Link>
            ))}
          </div>
        ) : game.related.length ? null : (
          <p className="text-sm text-faint">{game.similarGames.length ? "None of the similar games are on the shelf." : "IGDB lists no similar games."}</p>
        )}
        {game.related.length ? (
          <div className="mt-5">
            <h3 className="mb-2 text-sm text-muted">{owned.length ? "More like it on the shelf" : "Closest things on the shelf, by genre"}</h3>
            <div className="grid grid-cols-4 gap-2 sm:grid-cols-[repeat(auto-fill,minmax(100px,1fr))]" data-testid="related">
              {game.related.map((r) => (
                <Link key={r.id} href={`/game/${r.id}`} className="group" prefetch={false}>
                  <Cover imageId={r.cover} title={r.name} size="small" className="transition group-hover:-translate-y-1" />
                  <div className="mt-1 line-clamp-2 text-[11px]">{r.name}</div>
                </Link>
              ))}
            </div>
          </div>
        ) : null}
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
