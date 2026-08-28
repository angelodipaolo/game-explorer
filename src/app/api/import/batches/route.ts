import { handle, ok } from "@/lib/import/http";
import { listBatches } from "@/lib/import/service";

export async function GET() {
  return handle(async () => ok(await listBatches()));
}
