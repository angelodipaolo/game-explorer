"use client";

import Link from "next/link";
import type { ShelfGame } from "@/lib/collection";
import { cx } from "@/components/ui";
import { Cover } from "./cover";
import { PlayersLine, minutesLabel } from "./players-line";

export function GameCard({ game, dim, priority }: { game: ShelfGame; dim?: boolean; priority?: boolean }) {
  return (
    <Link href={`/game/${game.id}`} className={cx("group block animate-fade-up", dim && "opacity-70 hover:opacity-100")} data-testid="game-card" prefetch={false}>
      <div className="relative transition duration-200 group-hover:-translate-y-1 group-active:scale-[0.98]">
        <Cover imageId={game.cover} title={game.name} priority={priority} className="shadow-lg shadow-black/40 ring-1 ring-white/5 group-hover:ring-accent/60" />
        {dim ? <span className="absolute right-2 top-2 rounded-md bg-bg/80 px-1.5 py-0.5 text-xs text-muted backdrop-blur">?</span> : null}
        {game.copies.length > 1 || game.platform !== "nes" ? (
          <span className="absolute left-2 top-2 max-w-[calc(100%-1rem)] truncate rounded-md bg-bg/80 px-1.5 py-0.5 text-[10px] font-semibold tracking-wide text-text backdrop-blur">
            {game.copies.map((c) => c.platformLabel).join(" · ")}
          </span>
        ) : null}
      </div>
      <div className="mt-2 px-0.5">
        <div className="line-clamp-2 text-sm font-medium leading-snug">{game.name}</div>
        <div className="mt-0.5 flex items-center gap-1.5 text-xs">
          <PlayersLine players={game.players} />
          {game.playtime != null ? <span className="text-faint">· {minutesLabel(game.playtime)}</span> : null}
        </div>
      </div>
    </Link>
  );
}

export function GameRow({ game, dim }: { game: ShelfGame; dim?: boolean }) {
  return (
    <Link href={`/game/${game.id}`} className={cx("flex items-center gap-3 rounded-xl px-2 py-1.5 transition hover:bg-surface", dim && "opacity-70 hover:opacity-100")} data-testid="game-row" prefetch={false}>
      <Cover imageId={game.cover} title={game.name} size="small" className="w-10 shrink-0 rounded-md" />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium">{game.name}</div>
        <div className="truncate text-xs text-muted">
          {game.genres.slice(0, 3).join(" · ") || "—"}
        </div>
      </div>
      <div className="hidden w-28 shrink-0 truncate text-xs text-muted sm:block">{game.copies.map((c) => c.platformLabel).join(" · ")}{game.year ? ` · ${game.year}` : ""}</div>
      <div className="w-28 shrink-0 text-right text-xs sm:w-36">
        <PlayersLine players={game.players} />
        {dim ? <span className="ml-1 text-faint">?</span> : null}
      </div>
      <div className="hidden w-14 shrink-0 text-right text-xs text-faint sm:block">{minutesLabel(game.playtime) ?? ""}</div>
    </Link>
  );
}
