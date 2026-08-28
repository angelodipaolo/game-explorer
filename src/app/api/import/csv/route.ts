import { NextRequest } from "next/server";
import { csvToRows } from "@/lib/import/csv";
import { handle, ok } from "@/lib/import/http";
import { createSession } from "@/lib/import/service";

/**
 * POST /api/import/csv — multipart form with `file` (and optional `label`,
 * `defaultPlatform`), or a raw text/csv body. Creates a session directly.
 */
export async function POST(req: NextRequest) {
  return handle(async () => {
    let text: string;
    let label = "CSV import";
    let defaultPlatform: string | null = null;
    const contentType = req.headers.get("content-type") ?? "";
    if (contentType.includes("multipart/form-data")) {
      const form = await req.formData();
      const file = form.get("file");
      if (!(file instanceof File)) return ok({ error: "no file field" }, 400);
      text = await file.text();
      label = String(form.get("label") || file.name || label);
      defaultPlatform = (form.get("defaultPlatform") as string | null) || null;
    } else {
      text = await req.text();
      defaultPlatform = req.nextUrl.searchParams.get("defaultPlatform");
      label = req.nextUrl.searchParams.get("label") ?? label;
    }
    let parsed;
    try {
      parsed = csvToRows(text);
    } catch (e) {
      return ok({ error: (e as Error).message }, 400);
    }
    const session = await createSession({ label, source: "csv", defaultPlatform, rows: parsed.rows });
    return ok({ session, columns: parsed.columns, headers: parsed.headers, skipped: parsed.skipped }, 201);
  });
}
