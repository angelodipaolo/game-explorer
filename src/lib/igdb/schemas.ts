import { z } from "zod";

const named = z.object({ id: z.number(), name: z.string() });
const image = z.object({ image_id: z.string(), width: z.number().optional(), height: z.number().optional() });

export const igdbMultiplayerModeSchema = z
  .object({
    id: z.number(),
    platform: z.number().optional(),
    campaigncoop: z.boolean().optional(),
    dropin: z.boolean().optional(),
    lancoop: z.boolean().optional(),
    offlinecoop: z.boolean().optional(),
    offlinecoopmax: z.number().optional(),
    offlinemax: z.number().optional(),
    onlinecoop: z.boolean().optional(),
    onlinecoopmax: z.number().optional(),
    onlinemax: z.number().optional(),
    splitscreen: z.boolean().optional(),
  })
  .loose();

/** What a search hit carries — enough to rank and to show a candidate. */
export const igdbSearchHitSchema = z
  .object({
    id: z.number(),
    name: z.string(),
    slug: z.string().optional(),
    game_type: z.number().optional(),
    first_release_date: z.number().optional(),
    cover: image.optional(),
    platforms: z.array(named).optional(),
    alternative_names: z.array(z.object({ id: z.number(), name: z.string() })).optional(),
    parent_game: z.number().optional(),
    version_parent: z.number().optional(),
  })
  .loose();
export type IgdbSearchHit = z.infer<typeof igdbSearchHitSchema>;

export const igdbGameSchema = igdbSearchHitSchema
  .extend({
    summary: z.string().optional(),
    storyline: z.string().optional(),
    rating: z.number().optional(),
    rating_count: z.number().optional(),
    genres: z.array(named).optional(),
    themes: z.array(named).optional(),
    player_perspectives: z.array(named).optional(),
    keywords: z.array(named).optional(),
    involved_companies: z
      .array(
        z.object({
          company: named,
          developer: z.boolean().optional(),
          publisher: z.boolean().optional(),
        }),
      )
      .optional(),
    game_modes: z.array(z.number()).optional(),
    screenshots: z.array(image).optional(),
    similar_games: z.array(z.number()).optional(),
    multiplayer_modes: z.array(igdbMultiplayerModeSchema).optional(),
    /** IGDB collection (series) ids. Plural: a game is in several. */
    collections: z.array(z.number()).optional(),
    /** IGDB franchise ids. Coarser than a collection. */
    franchises: z.array(z.number()).optional(),
  })
  .loose();
export type IgdbGame = z.infer<typeof igdbGameSchema>;

/**
 * An IGDB *collection* — what IGDB calls a series ("Final Fantasy", "Mario
 * Party"). `games` is the complete member list as ids, owned or not, which is
 * what makes seeding a Series one request instead of web research.
 *
 * Note the ids in `games` have NOT been through the game_type rule: /collections
 * is not a /games query. Anything hydrated from this list goes through
 * syncCatalog, which applies it (see src/lib/catalog/collections.ts).
 */
export const igdbCollectionSchema = z
  .object({
    id: z.number(),
    name: z.string(),
    slug: z.string().optional(),
    games: z.array(z.number()).optional(),
  })
  .loose();
export type IgdbCollection = z.infer<typeof igdbCollectionSchema>;

export const igdbTimeToBeatSchema = z
  .object({
    game_id: z.number(),
    hastily: z.number().optional(),
    normally: z.number().optional(),
    completely: z.number().optional(),
    count: z.number().optional(),
  })
  .loose();
export type IgdbTimeToBeat = z.infer<typeof igdbTimeToBeatSchema>;

export const SEARCH_FIELDS = [
  "name",
  "slug",
  "game_type",
  "first_release_date",
  "cover.image_id",
  "cover.width",
  "cover.height",
  "platforms.id",
  "platforms.name",
  "alternative_names.name",
  "parent_game",
  "version_parent",
];

export const GAME_FIELDS = [
  ...SEARCH_FIELDS,
  "summary",
  "storyline",
  "rating",
  "rating_count",
  "genres.name",
  "themes.name",
  "player_perspectives.name",
  "keywords.name",
  "involved_companies.company.name",
  "involved_companies.developer",
  "involved_companies.publisher",
  "game_modes",
  "screenshots.image_id",
  "screenshots.width",
  "screenshots.height",
  "similar_games",
  "multiplayer_modes.*",
  // Plural arrays, both of them: a game sits in several collections (Final
  // Fantasy VII is in three) and sometimes several franchises. Cached on
  // CatalogGame so "propose members" can start from a game you own without a
  // round trip. The singular `collection`/`franchise` fields return nothing.
  "collections",
  "franchises",
];

/** /v4/collections. `games` is the whole member list. */
export const COLLECTION_FIELDS = ["name", "slug", "games"];

export const STUB_FIELDS = SEARCH_FIELDS;
