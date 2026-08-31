/**
 * The pure half of maps: marker kinds and their colours. No database, so the
 * client-side viewer can import it without dragging Prisma into the bundle.
 */

/**
 * A small, game-agnostic vocabulary. A Zelda dungeon, an FF cave and a Metroid
 * boss room all fit; anything that doesn't is `other` with the specifics in
 * the marker's note. Keep it short — every kind is a filter chip on a phone.
 */
export const MARKER_KINDS = ["town", "castle", "dungeon", "cave", "shop", "boss", "item", "secret", "travel", "other"] as const;
export type MarkerKind = (typeof MARKER_KINDS)[number];

export function isMarkerKind(k: string): k is MarkerKind {
  return (MARKER_KINDS as readonly string[]).includes(k);
}

export const KIND_LABELS: Record<MarkerKind, string> = {
  town: "Town",
  castle: "Castle",
  dungeon: "Dungeon",
  cave: "Cave",
  shop: "Shop",
  boss: "Boss",
  item: "Item",
  secret: "Secret",
  travel: "Travel",
  other: "Other",
};

/** Marker fill per kind. Chosen to read against both a blue ocean and a lava field. */
export const KIND_COLORS: Record<MarkerKind, string> = {
  town: "#e0a83a",
  castle: "#ececee",
  dungeon: "#d9534f",
  cave: "#a06ad6",
  shop: "#3fb7c9",
  boss: "#ff3b6b",
  item: "#7ad15b",
  secret: "#f2d64b",
  travel: "#8fd14f",
  other: "#9aa3b5",
};

export function kindColor(kind: string): string {
  return isMarkerKind(kind) ? KIND_COLORS[kind] : KIND_COLORS.other;
}

/** Enough to hold a dense overworld; more than that is a list nobody scrolls. */
export const MAX_MARKERS_PER_MAP = 300;
export const MAX_MAPS_PER_GAME = 20;

/** "Lunar Path 1 (north)" → "lunar-path-1-north". */
export function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}
