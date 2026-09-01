"use client";

import Link from "next/link";
import type { ShelfGame } from "@/lib/collection";
import { cx } from "@/components/ui";
import { Cover } from "./cover";
import { PlayersLine, minutesLabel } from "./players-line";

export function GameCard({ game, dim, priority }: { game: ShelfGame; dim?: boolean; priority?: boolean }) {
  return (
    // The "maybe" dimming rides on the art, not on the whole card. Opacity is
    // not inherited into a computed colour, so an `opacity-70` wrapper printed
    // `text-faint` at 3.63:1 while the token still measured 6.40:1 — and the
    // "?" badge, which is the actual meaning here, faded with it.
    <Link href={`/game/${game.id}`} className="group block animate-fade-up" data-testid="game-card" prefetch={false}>
      <div className="relative transition duration-200 group-hover:-translate-y-1 group-active:scale-[0.98]">
        <Cover imageId={game.cover} title={game.name} priority={priority} className={cx("shadow-lg shadow-black/40 ring-1 ring-white/5 group-hover:ring-accent/60", dim && "opacity-70 transition-opacity group-hover:opacity-100")} />
        {dim ? <span className="absolute right-2 top-2 rounded-md bg-bg/80 px-1.5 py-0.5 text-xs text-muted backdrop-blur">?</span> : null}
        {/* Open runs only. "Played" is deliberately unbadged: most of the shelf
            would carry one and it would read as wallpaper rather than news. */}
        {game.play.status === "playing" ? (
          <span className="absolute bottom-2 left-2 inline-flex items-center gap-1 rounded-md bg-accent px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-accent-ink shadow-lg shadow-black/40" data-testid="playing-marker">
            <span aria-hidden>▶</span> Playing
          </span>
        ) : null}
        {game.copies.length > 1 || game.platform !== "nes" ? (
          <span className="absolute left-2 top-2 max-w-[calc(100%-1rem)] truncate rounded-md bg-bg/80 px-1.5 py-0.5 text-[10px] font-semibold tracking-wide text-text backdrop-blur">
            {game.copies.map((c) => c.platformLabel).join(" · ")}
          </span>
        ) : null}
      </div>
      <div className="mt-2 px-0.5">
        <div className="line-clamp-2 text-sm font-medium leading-snug">{game.name}</div>
        {/* min-w-0 so the players line can truncate instead of wrapping the
            card to three lines on a 375px two-column grid. */}
        <div className="mt-0.5 flex min-w-0 items-center gap-1.5 text-xs">
          <PlayersLine players={game.players} brief className="min-w-0" />
          {game.playtime != null ? <span className="shrink-0 text-faint">· {minutesLabel(game.playtime)}</span> : null}
        </div>
      </div>
    </Link>
  );
}

export function GameRow({ game, dim }: { game: ShelfGame; dim?: boolean }) {
  return (
    // Same trade as the card: the thumbnail dims, the text does not, and the
    // "?" at the end of the row is what says "we do not know".
    <Link href={`/game/${game.id}`} className="group flex items-center gap-3 rounded-xl px-2 py-1.5 transition hover:bg-surface" data-testid="game-row" prefetch={false}>
      <Cover imageId={game.cover} title={game.name} size="small" className={cx("w-10 shrink-0 rounded-md", dim && "opacity-70 transition-opacity group-hover:opacity-100")} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          {game.play.status === "playing" ? (
            // A bare glyph: `role="img"` + a label is what makes it reach a
            // screen reader at all, since there is no room for the word here.
            <span role="img" aria-label="Playing" className="shrink-0 rounded bg-accent px-1 text-[10px] font-bold uppercase text-accent-ink" data-testid="playing-marker">
              ▶
            </span>
          ) : null}
          <span className="truncate text-sm font-medium">{game.name}</span>
        </div>
        <div className="truncate text-xs text-muted">
          {game.genres.slice(0, 3).join(" · ") || "—"}
        </div>
      </div>
      <div className="hidden w-28 shrink-0 truncate text-xs text-muted sm:block">{game.copies.map((c) => c.platformLabel).join(" · ")}{game.year ? ` · ${game.year}` : ""}</div>
      <div className="w-28 shrink-0 text-right text-xs sm:w-36">
        <PlayersLine players={game.players} brief />
        {dim ? <span className="ml-1 text-faint">?</span> : null}
      </div>
      <div className="hidden w-14 shrink-0 text-right text-xs text-faint sm:block">{minutesLabel(game.playtime) ?? ""}</div>
    </Link>
  );
}
