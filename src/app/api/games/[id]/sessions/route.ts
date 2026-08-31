import { NextRequest } from "next/server";
import { EnrichmentError } from "@/lib/enrichment/service";
import { handle, ok } from "@/lib/enrichment/http";
import { createSessionSchema, logPastSession, sessionsFor, startSession } from "@/lib/play/service";

type Ctx = { params: Promise<{ id: string }> };

/** GET /api/games/:id/sessions — this copy's runs, newest first. */
export async function GET(_req: NextRequest, ctx: Ctx) {
  return handle(async () => ok(await sessionsFor((await ctx.params).id)));
}

/**
 * POST /api/games/:id/sessions { startedAt?, endedAt?, undated?, outcome?, note? }
 *
 * One route for three shapes: with `endedAt` it logs a run that already
 * happened, with `undated` it logs one that happened at a time nobody
 * remembers, and with neither it starts one now (409 if this copy already has
 * an open run, and it drops the copy out of the play queue in the same
 * transaction). `undated` is a past run despite having no end date — the
 * absence of dates there means "forgotten", not "still going".
 */
export async function POST(req: NextRequest, ctx: Ctx) {
  return handle(async () => {
    const { id } = await ctx.params;
    // "Start playing" is a bare tap, so a genuinely empty body means "now".
    // Malformed JSON is still a 400 through handle(), like every other route —
    // only an absent body is defaulted, never a broken one.
    const raw = (await req.text()).trim();
    const body = createSessionSchema.parse(raw ? JSON.parse(raw) : {});
    if (body.endedAt || body.undated) {
      // Consistent with PATCH: a run that already happened is not "playing",
      // and an undated one is a past run by definition.
      if (body.outcome === "playing") throw new EnrichmentError('a finished run cannot have the outcome "playing" — leave endedAt out to start one', 400);
      // Dates and "the dates are lost" are contradictory. Say so rather than
      // quietly picking one — the same refusal pastSessionSchema makes.
      if (body.undated && (body.startedAt || body.endedAt)) throw new EnrichmentError("an undated run has no dates — send undated on its own", 400);
      const past = body.endedAt
        ? { startedAt: body.startedAt ?? body.endedAt, endedAt: body.endedAt, outcome: body.outcome, note: body.note }
        : { undated: true as const, outcome: body.outcome, note: body.note };
      return ok(await logPastSession(id, past), 201);
    }
    return ok(await startSession(id, { startedAt: body.startedAt, note: body.note }), 201);
  });
}
