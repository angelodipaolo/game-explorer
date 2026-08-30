/**
 * The pure half of codes: kinds, the cap, and the dedupe key. No database, so
 * client components can import it without dragging Prisma into the bundle.
 */

/**
 * `action-replay` covers the whole cheat-device family (Pro Action Replay,
 * GameShark, Game Genie's later rivals) — which box it was is a detail for
 * `effect` or `note`, not a kind of its own.
 */
export const CODE_KINDS = ["password", "cheat", "game-genie", "action-replay"] as const;
export type CodeKind = (typeof CODE_KINDS)[number];

export function isCodeKind(k: string): k is CodeKind {
  return (CODE_KINDS as readonly string[]).includes(k);
}

/** Headings, in the order they read on the page. */
export const KIND_LABELS: Record<CodeKind, string> = {
  password: "Passwords",
  cheat: "Cheats",
  "game-genie": "Game Genie",
  "action-replay": "Action Replay / GameShark",
};

/** Singular, for the "kind" picker in the edit form. */
export const KIND_OPTIONS: Record<CodeKind, string> = {
  password: "Password",
  cheat: "Cheat",
  "game-genie": "Game Genie",
  "action-replay": "Action Replay / GameShark",
};

/** Kinds sort by their position in CODE_KINDS, not alphabetically. */
export function kindRank(kind: string): number {
  const i = (CODE_KINDS as readonly string[]).indexOf(kind);
  return i === -1 ? CODE_KINDS.length : i;
}

/**
 * A curated handful per game, not an exhaustive password dump. The cap is what
 * keeps this a section you read on a phone rather than a list you paginate.
 */
export const MAX_CODES_PER_GAME = 30;

const squash = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, "");

/**
 * Dedupe key: the code with case and punctuation thrown away, so "SXIOPO" and
 * "sx-io-po" are the same row. Cheats whose entry sequence *is* the code carry
 * no `code`, so they fall back to the effect.
 */
export function codeKeyOf(code: string | null | undefined, effect: string): string {
  return (code ? squash(code) : "") || squash(effect) || effect.trim().toUpperCase();
}
