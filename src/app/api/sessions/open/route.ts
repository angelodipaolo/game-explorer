import { handle, ok } from "@/lib/enrichment/http";
import { listOpenSessions } from "@/lib/play/service";

/** GET /api/sessions/open — every run in progress, newest first. Behind /playing. */
export async function GET() {
  return handle(async () => ok(await listOpenSessions()));
}
