import { NextRequest } from "next/server";
import { z } from "zod";
import { FACT_FIELDS } from "@/lib/facts";
import { handle, ok } from "@/lib/enrichment/http";
import { writeManualFact } from "@/lib/enrichment/service";
import { prisma } from "@/lib/db";

const body = z.object({ field: z.enum(FACT_FIELDS), value: z.union([z.boolean(), z.number().int()]).nullable(), note: z.string().max(500).optional() });

/** PUT /api/games/:id/facts { field, value, note? } — a hand-set fact (null clears it). Beats IGDB and agents. */
export async function PUT(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const input = body.parse(await req.json());
    return ok(await writeManualFact((await ctx.params).id, input.field, input.value, input.note));
  });
}

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => ok(await prisma.gameFact.findMany({ where: { ownedGameId: (await ctx.params).id } })));
}
