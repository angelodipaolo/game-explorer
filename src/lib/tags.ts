/**
 * Tags layered over IGDB's genres / perspectives / themes.
 *
 *   effective = igdb tags ∪ manual ∪ agent − hidden
 *
 * `key` is the normalised form ("metroidvania"); `tag` keeps the spelling of
 * whoever added it first. Manual beats agent: an agent cannot remove or
 * override a manual tag, and an agent tag that duplicates a manual one is
 * skipped.
 */

export type TagSource = "igdb" | "manual" | "agent";
export type EffectiveTag = { tag: string; key: string; source: TagSource; sourceUrl?: string | null; note?: string | null };
export type TagRow = { key: string; tag: string; source: string; sourceUrl?: string | null; note?: string | null };

export function tagKey(tag: string): string {
  return tag
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function displayTag(tag: string): string {
  return tag.replace(/\s+/g, " ").trim();
}

/** Combine catalog lists with GameTag rows for one owned game. */
export function resolveTags(igdb: { genres: string[]; perspectives: string[]; themes: string[] }, rows: TagRow[]): EffectiveTag[] {
  const hidden = new Set(rows.filter((r) => r.source === "igdb-hide").map((r) => r.key));
  const out = new Map<string, EffectiveTag>();
  for (const t of [...igdb.genres, ...igdb.perspectives, ...igdb.themes]) {
    const key = tagKey(t);
    if (!key || hidden.has(key) || out.has(key)) continue;
    out.set(key, { tag: t, key, source: "igdb" });
  }
  // manual first so it wins over agent
  for (const r of [...rows].sort((a, b) => (a.source === "manual" ? -1 : 0) - (b.source === "manual" ? -1 : 0))) {
    if (r.source !== "manual" && r.source !== "agent") continue;
    const existing = out.get(r.key);
    if (existing && (existing.source === "manual" || existing.source === "igdb")) continue;
    out.set(r.key, { tag: displayTag(r.tag), key: r.key, source: r.source, sourceUrl: r.sourceUrl ?? null, note: r.note ?? null });
  }
  return [...out.values()];
}
