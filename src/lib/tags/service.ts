import { z } from "zod";
import { prisma } from "@/lib/db";
import { EnrichmentError } from "@/lib/enrichment/service";
import { displayTag, tagKey } from "@/lib/tags";

export const tagSchema = z.string().trim().min(1).max(40);

/** Every tag in use (manual/agent) with counts — for suggestions and agents. */
export async function listTags() {
  const rows = await prisma.gameTag.findMany({ where: { source: { in: ["manual", "agent"] } }, select: { key: true, tag: true, source: true } });
  const m = new Map<string, { tag: string; count: number; manual: number; agent: number }>();
  for (const r of rows) {
    const cur = m.get(r.key) ?? { tag: r.tag, count: 0, manual: 0, agent: 0 };
    cur.count++;
    if (r.source === "manual") cur.manual++;
    else cur.agent++;
    m.set(r.key, cur);
  }
  return [...m].map(([key, v]) => ({ key, ...v })).sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
}

export async function tagsFor(ownedGameId: string) {
  return prisma.gameTag.findMany({ where: { ownedGameId }, orderBy: { createdAt: "asc" } });
}

/** the owner adds a tag. Replaces any agent tag with the same key. */
export async function addManualTag(ownedGameId: string, tag: string, note?: string) {
  const key = tagKey(tag);
  if (!key) throw new EnrichmentError("empty tag", 400);
  await prisma.gameTag.deleteMany({ where: { ownedGameId, key, source: "agent" } });
  return prisma.gameTag.upsert({
    where: { ownedGameId_key_source: { ownedGameId, key, source: "manual" } },
    create: { ownedGameId, key, tag: displayTag(tag), source: "manual", note: note ?? null },
    update: { tag: displayTag(tag), note: note ?? null },
  });
}

/** Remove a manual/agent tag, or hide an IGDB one (or unhide it). */
export async function removeTag(ownedGameId: string, tag: string, opts: { igdb?: boolean } = {}) {
  const key = tagKey(tag);
  if (opts.igdb) {
    return prisma.gameTag.upsert({
      where: { ownedGameId_key_source: { ownedGameId, key, source: "igdb-hide" } },
      create: { ownedGameId, key, tag: displayTag(tag), source: "igdb-hide" },
      update: {},
    });
  }
  await prisma.gameTag.deleteMany({ where: { ownedGameId, key, source: { in: ["manual", "agent"] } } });
  return null;
}

export async function unhideTag(ownedGameId: string, tag: string) {
  await prisma.gameTag.deleteMany({ where: { ownedGameId, key: tagKey(tag), source: "igdb-hide" } });
}

export const agentTagsSchema = z.object({
  tags: z.array(z.object({ ownedGameId: z.string().min(1), tag: tagSchema, sourceUrl: z.string().url(), note: z.string().max(300).optional() })).min(1).max(1000),
});

/** Agent tags: cited, never overriding a manual tag, attributed to a run. */
export async function writeAgentTags(runId: string, tags: z.infer<typeof agentTagsSchema>["tags"]) {
  const run = await prisma.enrichmentRun.findUnique({ where: { id: runId } });
  if (!run) throw new EnrichmentError("run not found", 404);
  if (run.finishedAt) throw new EnrichmentError("run is finished", 409);
  const written: { ownedGameId: string; tag: string }[] = [];
  const skipped: { ownedGameId: string; tag: string; reason: string }[] = [];
  for (const t of tags) {
    const key = tagKey(t.tag);
    const owned = await prisma.ownedGame.findUnique({ where: { id: t.ownedGameId }, select: { id: true } });
    if (!owned) {
      skipped.push({ ownedGameId: t.ownedGameId, tag: t.tag, reason: "owned game not found" });
      continue;
    }
    const manual = await prisma.gameTag.findFirst({ where: { ownedGameId: t.ownedGameId, key, source: "manual" } });
    if (manual) {
      skipped.push({ ownedGameId: t.ownedGameId, tag: t.tag, reason: "already set by hand" });
      continue;
    }
    await prisma.gameTag.upsert({
      where: { ownedGameId_key_source: { ownedGameId: t.ownedGameId, key, source: "agent" } },
      create: { ownedGameId: t.ownedGameId, key, tag: displayTag(t.tag), source: "agent", sourceUrl: t.sourceUrl, note: t.note ?? null, runId },
      update: { tag: displayTag(t.tag), sourceUrl: t.sourceUrl, note: t.note ?? null, runId },
    });
    written.push({ ownedGameId: t.ownedGameId, tag: t.tag });
  }
  return { written, skipped };
}
