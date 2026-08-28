/**
 * APIcalypse query builder. The one rule that matters: every /games query
 * carries a `game_type` filter that excludes mods/romhacks. Without it IGDB's
 * NES catalog serves romhacks first and their tags get imported as fact.
 */

export const MAIN_GAME_TYPE = 0;
/** IGDB classifies many real cartridges (NES Pac-Man, Gauntlet, Tetris) as ports of an arcade/other original. */
export const PORT_GAME_TYPE = 11;
/**
 * game_type values that can be a physical cartridge. Measured against the real
 * collection (see notes/decisions.md): Main Game 0, Bundle 3 (compilation
 * carts like "Super Mario Bros. / Duck Hunt"), Remake 8, Remaster 9, Expanded
 * Game 10 ("Mega Man 2", "Jackal"), Port 11 ("Contra", "Gauntlet", "Tetris").
 */
export const CARTRIDGE_GAME_TYPES = [0, 3, 8, 9, 10, 11];
/** Never a physical cartridge: DLC, expansion, mod/romhack, episode, season, fork, pack, update. */
const FORBIDDEN_GAME_TYPES = new Set([1, 2, 5, 6, 7, 12, 13, 14]);

export type GameQueryOptions = {
  fields: string[];
  search?: string;
  ids?: number[];
  platformIds?: number[];
  /** Extra raw where clauses, ANDed. */
  where?: string[];
  limit?: number;
  offset?: number;
  /** Which IGDB game_type values to allow. Defaults to CARTRIDGE_GAME_TYPES. Forbidden types throw. */
  gameTypes?: number[];
};

function quote(s: string): string {
  return `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

export function buildGameQuery(opts: GameQueryOptions): string {
  const parts: string[] = [];
  if (opts.search) parts.push(`search ${quote(opts.search)}`);
  parts.push(`fields ${opts.fields.join(", ")}`);

  const types = opts.gameTypes && opts.gameTypes.length ? [...new Set(opts.gameTypes)] : CARTRIDGE_GAME_TYPES;
  for (const t of types) {
    if (FORBIDDEN_GAME_TYPES.has(t)) throw new Error(`game_type ${t} is never a physical cartridge`);
  }
  const where = [types.length === 1 ? `game_type = ${types[0]}` : `game_type = (${types.join(",")})`];
  if (opts.ids && opts.ids.length) where.push(`id = (${opts.ids.join(",")})`);
  if (opts.platformIds && opts.platformIds.length) where.push(`platforms = (${opts.platformIds.join(",")})`);
  if (opts.where) where.push(...opts.where);
  parts.push(`where ${where.join(" & ")}`);

  if (opts.limit != null) parts.push(`limit ${opts.limit}`);
  if (opts.offset != null) parts.push(`offset ${opts.offset}`);
  return parts.join("; ") + ";";
}

/** Generic builder for non-game endpoints (time to beat, etc.). */
export function buildQuery(opts: { fields: string[]; where?: string[]; limit?: number; offset?: number }): string {
  const parts = [`fields ${opts.fields.join(", ")}`];
  if (opts.where && opts.where.length) parts.push(`where ${opts.where.join(" & ")}`);
  if (opts.limit != null) parts.push(`limit ${opts.limit}`);
  if (opts.offset != null) parts.push(`offset ${opts.offset}`);
  return parts.join("; ") + ";";
}
