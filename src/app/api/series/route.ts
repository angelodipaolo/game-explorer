import { NextRequest } from "next/server";
import { handle, ok } from "@/lib/enrichment/http";
import { createSeries, listSeries, seriesInputSchema } from "@/lib/series/service";

/**
 * The series API, shaped like find-codes end to end so a research skill can
 * drive exactly what the owner drives. No `source`, no precedence: a series
 * curated by hand and one curated by a citing skill are the same record.
 *
 * GET  /api/series — every series as a card (name, derived cover, "7 of 16").
 * POST /api/series { name, slug?, blurb?, seedCollectionId?, seen?, entries? }
 *   The save at the end of the prune: the kept entries in order, plus `seen`
 *   listing every id the seed offered so a later check reports only what is
 *   genuinely new. Entries you do not own are hydrated into the catalog here.
 */
export async function GET() {
  return handle(async () => ok(await listSeries()));
}

export async function POST(req: NextRequest) {
  return handle(async () => ok(await createSeries(seriesInputSchema.parse(await req.json())), 201));
}
