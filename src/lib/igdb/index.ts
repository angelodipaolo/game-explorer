/**
 * Public surface of the IGDB module. Only src/lib/catalog and scripts/ may
 * import from here — see boundary.test.ts.
 */
import { IgdbClient, getIgdbClient } from "./client";
import { buildGameQuery, buildQuery } from "./query";
import {
  GAME_FIELDS,
  SEARCH_FIELDS,
  STUB_FIELDS,
  igdbGameSchema,
  igdbSearchHitSchema,
  igdbTimeToBeatSchema,
  type IgdbGame,
  type IgdbSearchHit,
  type IgdbTimeToBeat,
} from "./schemas";

export { IgdbClient, IgdbError, getIgdbClient } from "./client";
export { buildGameQuery, buildQuery, MAIN_GAME_TYPE, PORT_GAME_TYPE, CARTRIDGE_GAME_TYPES } from "./query";
export type { IgdbGame, IgdbSearchHit, IgdbTimeToBeat } from "./schemas";
export { GAME_FIELDS, SEARCH_FIELDS, STUB_FIELDS };

export type IgdbApi = {
  /** Search main games, optionally restricted to platforms. */
  search(term: string, platformIds?: number[], limit?: number, gameTypes?: number[]): Promise<IgdbSearchHit[]>;
  /** Full detail for a set of ids (chunked). */
  games(ids: number[]): Promise<IgdbGame[]>;
  /** Stub detail (name, cover, platforms) for a set of ids (chunked). */
  stubs(ids: number[]): Promise<IgdbSearchHit[]>;
  timeToBeat(ids: number[]): Promise<IgdbTimeToBeat[]>;
};

const CHUNK = 100;

function chunk<T>(xs: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n));
  return out;
}

export function igdbApi(client: IgdbClient = getIgdbClient()): IgdbApi {
  return {
    async search(term, platformIds, limit = 10, gameTypes) {
      return client.query("games", buildGameQuery({ search: term, fields: SEARCH_FIELDS, platformIds, limit, gameTypes }), igdbSearchHitSchema);
    },
    async games(ids) {
      const out: IgdbGame[] = [];
      for (const part of chunk([...new Set(ids)], CHUNK)) {
        out.push(...(await client.query("games", buildGameQuery({ fields: GAME_FIELDS, ids: part, limit: CHUNK }), igdbGameSchema)));
      }
      return out;
    },
    async stubs(ids) {
      const out: IgdbSearchHit[] = [];
      for (const part of chunk([...new Set(ids)], CHUNK)) {
        out.push(...(await client.query("games", buildGameQuery({ fields: STUB_FIELDS, ids: part, limit: CHUNK }), igdbSearchHitSchema)));
      }
      return out;
    },
    async timeToBeat(ids) {
      const out: IgdbTimeToBeat[] = [];
      for (const part of chunk([...new Set(ids)], CHUNK)) {
        out.push(
          ...(await client.query(
            "game_time_to_beats",
            buildQuery({ fields: ["game_id", "hastily", "normally", "completely", "count"], where: [`game_id = (${part.join(",")})`], limit: CHUNK }),
            igdbTimeToBeatSchema,
          )),
        );
      }
      return out;
    },
  };
}
