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
 * POST /api/games/:id/sessions { startedAt?, endedAt?, outcome?, note? }
 *
 * One route for both shapes: with `endedAt` it logs a run that already
 * happened, without it it starts one now (409 if this copy already has an open
 * run, and it drops the copy out of the play queue in the same transaction).
 */
export async function POST(req: NextRequest, ctx: Ctx) {
  return handle(async () => {
    const { id } = await ctx.params;
    // "Start playing" is a bare tap, so a genuinely empty body means "now".
    // Malformed JSON is still a 400 through handle(), like every other route —
    // only an absent body is defaulted, never a broken one.
    const raw = (await req.text()).trim();
    const body = createSessionSchema.parse(raw ? JSON.parse(raw) : {});
    if (body.endedAt) {
      // Consistent with PATCH: a run with an end date is not "playing".
      if (body.outcome === "playing") throw new EnrichmentError('a finished run cannot have the outcome "playing" — leave endedAt out to start one', 400);
      return ok(await logPastSession(id, { startedAt: body.startedAt ?? body.endedAt, endedAt: body.endedAt, outcome: body.outcome, note: body.note }), 201);
    }
    return ok(await startSession(id, { startedAt: body.startedAt, note: body.note }), 201);
  });
}
