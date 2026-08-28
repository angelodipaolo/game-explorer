import { NextRequest } from "next/server";
import { handle, ok } from "@/lib/import/http";
import { createSessionSchema } from "@/lib/import/schema";
import { createSession, listSessions } from "@/lib/import/service";

/**
 * POST /api/import/sessions
 *   { label, source?, defaultPlatform?, rows?: [{ title, platform?, quantity?, completeness?, condition?, notes?, igdbId? }] }
 * Creates a staged session. Rows are validated, deduped and matched immediately.
 * Submit in batches of ≤ 25 rows via POST /api/import/sessions/:id/rows to keep each call short.
 */
export async function POST(req: NextRequest) {
  return handle(async () => {
    const input = createSessionSchema.parse(await req.json());
    const session = await createSession(input);
    return ok(session, 201);
  });
}

export async function GET() {
  return handle(async () => ok(await listSessions()));
}
