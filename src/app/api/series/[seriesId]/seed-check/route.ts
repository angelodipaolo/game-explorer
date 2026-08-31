import { NextRequest } from "next/server";
import { handle, ok } from "@/lib/enrichment/http";
import { checkSeed } from "@/lib/series/service";

type Ctx = { params: Promise<{ seriesId: string }> };

/**
 * POST /api/series/:seriesId/seed-check — "check for new entries".
 *
 * Diffs the IGDB collection this series was seeded from against what it
 * already knows: current entries plus every id a previous prune showed. What
 * comes back in `fresh` is only what has appeared since, and it is a review —
 * accept the ones that belong by POSTing them to .../entries with `seen`
 * covering everything offered. Nothing merges on its own, deliberately: the
 * alternative (treat the collection as live, entries as an exclusion list)
 * lets IGDB rewrite the page.
 */
export async function POST(_req: NextRequest, ctx: Ctx) {
  return handle(async () => ok(await checkSeed((await ctx.params).seriesId)));
}
