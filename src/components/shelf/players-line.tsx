import type { ShelfGame } from "@/lib/collection";
import { PLAYER_LABELS, tierHint } from "@/lib/players";
import { cx } from "@/components/ui";

/**
 * The compact player line on a card or a row — the range first, then at most
 * two qualifiers: `1–2 · Local co-op · Together`, `1–4 · Versus`, `1 player`,
 * `? players`. The wording is `describePlayers`' (`src/lib/players.ts`), built
 * on the server; this only styles it by how much we know.
 *
 * `brief` is for the places with no room — a two-column phone card is about
 * 170px wide, so it takes the one-qualifier line ("1–2 · Local co-op") and
 * leaves "Together" to Flip and the game page rather than ellipsing it.
 * `truncate` is the backstop for a very long title-less card, and needs
 * `min-w-0` on the flex parent to bite.
 */
export function PlayersLine({ players, brief, className }: { players: ShelfGame["players"]; brief?: boolean; className?: string }) {
  const label = (brief ? players.brief : players.label) || PLAYER_LABELS.unknown;
  return (
    <span className={cx("inline-block max-w-full truncate align-bottom", players.tier === "unknown" ? "text-faint" : players.tier === "mode" ? "text-muted" : "text-text", className)} title={`${label} — ${tierHint(players.tier)}`}>
      {label}
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
