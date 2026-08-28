import { z } from "zod";

/** One row as an agent (or the CSV parser) submits it. Already parsed and normalized — no CSV here. */
export const importRowInputSchema = z.object({
  title: z.string().trim().min(1, "title is required").max(200),
  /** Free text; resolved through platform aliases. Null means "unknown, assume default". */
  platform: z.string().trim().max(60).nullable().optional(),
  quantity: z.coerce.number().int().min(1).max(999).default(1),
  completeness: z.string().trim().max(40).nullable().optional(),
  condition: z.string().trim().max(40).nullable().optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
  /** The agent may pin the IGDB id when it has already resolved the game. */
  igdbId: z.number().int().positive().nullable().optional(),
});
export type ImportRowInput = z.infer<typeof importRowInputSchema>;

export const createSessionSchema = z.object({
  label: z.string().trim().min(1).max(120),
  source: z.enum(["agent", "csv", "migration"]).default("agent"),
  /** Platform to assume when a row has none. */
  defaultPlatform: z.string().trim().max(60).nullable().optional(),
  rows: z.array(importRowInputSchema).max(2000).default([]),
});
export type CreateSessionInput = z.infer<typeof createSessionSchema>;

export const addRowsSchema = z.object({
  rows: z.array(importRowInputSchema).min(1).max(2000),
});

export const decideRowSchema = z.object({
  /** accepted: link to igdbId (or none); dropped: leave out; merge: fold into the colliding owned game. */
  decision: z.enum(["accepted", "dropped", "merge"]),
  igdbId: z.number().int().positive().nullable().optional(),
  title: z.string().trim().min(1).max(200).optional(),
  platform: z.string().trim().max(60).optional(),
  quantity: z.number().int().min(1).max(999).optional(),
  decidedBy: z.enum(["user", "agent"]).default("user"),
});
export type DecideRowInput = z.infer<typeof decideRowSchema>;

export const commitSchema = z.object({
  /** Commit even with rows still in review: they are imported without a catalog link. */
  force: z.boolean().default(false),
});
