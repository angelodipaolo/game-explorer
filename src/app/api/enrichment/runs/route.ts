import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { handle, ok } from "@/lib/enrichment/http";
import { startRun } from "@/lib/enrichment/service";

/** POST /api/enrichment/runs { label? } → a run to write facts into. */
export async function POST(req: NextRequest) {
  return handle(async () => {
    const text = await req.text();
    const { label } = z.object({ label: z.string().max(120).optional() }).parse(text ? JSON.parse(text) : {});
    return ok(await startRun(label), 201);
  });
}

export async function GET() {
  return handle(async () => ok(await prisma.enrichmentRun.findMany({ orderBy: { startedAt: "desc" } })));
}
