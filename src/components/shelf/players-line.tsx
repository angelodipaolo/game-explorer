import type { ShelfGame } from "@/lib/collection";
import { cx } from "@/components/ui";

/** "1–2 players together" / "Co-op" / "Players unknown", styled by how much we know. */
export function PlayersLine({ players, className }: { players: ShelfGame["players"]; className?: string }) {
  return (
    <span className={cx(players.tier === "unknown" ? "text-faint" : players.tier === "mode" ? "text-muted" : "text-text", className)} title={players.tier === "unknown" ? "No player data yet" : players.tier === "mode" ? "From IGDB game modes" : "Exact count"}>
      {players.tier === "unknown" ? "? players" : players.label}
      {players.verified ? <span className="ml-1 text-good" title="Verified by hand or an enrichment run">✓</span> : null}
    </span>
  );
}

export function minutesLabel(m: number | null): string | null {
  if (m == null) return null;
  if (m < 60) return `${m} min`;
  const h = Math.round((m / 60) * 2) / 2;
  return `${h} h`;
}
