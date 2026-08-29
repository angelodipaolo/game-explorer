import { handle, ok } from "@/lib/enrichment/http";
import { listTags } from "@/lib/tags/service";

/** GET /api/tags — every manual/agent tag in use, with counts. */
export async function GET() {
  return handle(async () => ok(await listTags()));
}
