import { NextRequest } from "next/server";
import { handle, ok } from "@/lib/enrichment/http";
import { enqueue, enqueueSchema, loadQueue, reorderQueue, reorderQueueSchema } from "@/lib/play/service";

/** GET /api/queue — the one ordered "up next" list, in order. */
export async function GET() {
  return handle(async () => ok(await loadQueue()));
}

/**
 * POST /api/queue { ownedGameId, position?, note? } — add, or move the entry
 * already there. 400 when that copy has a run in progress: it cannot be both.
 */
export async function POST(req: NextRequest) {
  return handle(async () => {
    const { ownedGameId, ...rest } = enqueueSchema.parse(await req.json());
    return ok(await enqueue(ownedGameId, rest), 201);
  });
}

/**
 * PATCH /api/queue { orderedIds } — the whole new order in one transaction.
 * The list must be a permutation of what is queued, so a stale client cannot
 * drop an entry by leaving it out.
 */
export async function PATCH(req: NextRequest) {
  return handle(async () => ok(await reorderQueue(reorderQueueSchema.parse(await req.json()).orderedIds)));
}
