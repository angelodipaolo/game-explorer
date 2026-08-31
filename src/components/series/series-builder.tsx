"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { Button, apiError, cx } from "@/components/ui";
import { coverUrl } from "@/components/shelf/cover";
import { seenIdsOf, slugify } from "@/lib/series/shape";

/**
 * Seed → prune → save, in one page.
 *
 * Pruning *is* the workflow — collection 39 "Final Fantasy" has 191 members
 * and the series people mean has about twenty — so the candidate list is the
 * main screen here and typing entries by hand is not offered at all. Every
 * candidate starts ticked, because unticking the ports and the JP variants is
 * the smaller job.
 *
 * Desktop-leaning, but it has to work one-handed: the rows are 44px+ tap
 * targets, the list scrolls with the page rather than inside a nested box, and
 * the save bar sticks to the bottom of the viewport.
 */

type OwnedGame = { igdbId: number; name: string; year: number | null };
type Collection = { id: number; name: string; slug: string | null; gameIds: number[] };
type Candidate = {
  igdbId: number;
  name: string;
  cover: string | null;
  year: number | null;
  variants: { igdbId: number; name: string; year: number | null }[];
  ownedId: string | null;
  platformLabel: string | null;
};
type Seed = { collection: Collection; candidates: Candidate[]; skipped: number[] };

export function SeriesBuilder({ games }: { games: OwnedGame[] }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [collectionId, setCollectionId] = useState("");
  const [collections, setCollections] = useState<Collection[] | null>(null);
  const [seed, setSeed] = useState<Seed | null>(null);
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [sections, setSections] = useState<Record<number, string>>({});
  const [showSections, setShowSections] = useState(false);
  const [name, setName] = useState("");
  const [blurb, setBlurb] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q.length < 2) return [];
    return games.filter((g) => g.name.toLowerCase().includes(q)).slice(0, 8);
  }, [games, query]);

  async function call<T>(url: string, init?: RequestInit): Promise<T | null> {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(url, init);
      if (!res.ok) throw await apiError(res);
      return (await res.json()) as T;
    } catch (e) {
      setError((e as Error).message);
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function findCollections(igdbId: number, label: string) {
    setQuery(label);
    const list = await call<Collection[]>(`/api/series/collections?igdbId=${igdbId}`);
    if (list) setCollections(list);
  }

  async function seedFrom(id: number, suggestedName?: string) {
    const result = await call<Seed>("/api/series/seed-preview", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ collectionId: id }) });
    if (!result) return;
    setSeed(result);
    setPicked(new Set(result.candidates.map((c) => c.igdbId)));
    setName(suggestedName ?? result.collection.name);
  }

  async function save() {
    if (!seed) return;
    const kept = seed.candidates.filter((c) => picked.has(c.igdbId));
    if (!kept.length) {
      setError("Keep at least one entry.");
      return;
    }
    const created = await call<{ slug: string }>("/api/series", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: name.trim() || seed.collection.name,
        blurb: blurb.trim() || null,
        seedCollectionId: seed.collection.id,
        // Everything that was offered, kept or not — the collapsed ports
        // included, because IGDB can drop a parent and hand one of them back as
        // its own candidate. A "check for new entries" later must not re-offer
        // anything on this screen.
        seen: seenIdsOf(seed.candidates),
        entries: kept.map((c) => ({ igdbId: c.igdbId, section: sections[c.igdbId]?.trim() || null })),
      }),
    });
    if (created) router.push(`/series/${created.slug}`);
  }

  const toggle = (igdbId: number) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(igdbId)) next.delete(igdbId);
      else next.add(igdbId);
      return next;
    });

  if (!seed) {
    return (
      <div className="mt-6 flex flex-col gap-6" data-testid="series-seed-step">
        <section>
          <label htmlFor="series-game" className="font-display text-sm font-bold">
            1 · Start from a game you own
          </label>
          <p className="mb-2 text-xs text-muted">IGDB will say which series it belongs to.</p>
          <input
            id="series-game"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setCollections(null);
            }}
            placeholder="Final Fantasy VII…"
            className="min-h-11 w-full rounded-xl border border-border bg-surface px-3 text-sm"
            data-testid="series-game-search"
          />
          {matches.length ? (
            <ul className="mt-2 flex flex-col gap-1" data-testid="series-game-matches">
              {matches.map((g) => (
                <li key={g.igdbId}>
                  <button type="button" disabled={busy} onClick={() => findCollections(g.igdbId, g.name)} className="flex min-h-11 w-full items-center justify-between gap-3 rounded-xl border border-border bg-surface px-3 text-left text-sm hover:border-muted">
                    <span className="truncate">{g.name}</span>
                    <span className="shrink-0 text-xs text-faint tabular-nums">{g.year ?? ""}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
          {collections ? (
            collections.length ? (
              <ul className="mt-3 flex flex-col gap-1" data-testid="series-collections">
                {collections.map((c) => (
                  <li key={c.id}>
                    <button type="button" disabled={busy} onClick={() => seedFrom(c.id)} className="flex min-h-11 w-full items-center justify-between gap-3 rounded-xl border border-accent/40 bg-accent/5 px-3 text-left text-sm hover:border-accent" data-testid="series-collection">
                      <span className="truncate font-semibold">{c.name}</span>
                      <span className="shrink-0 text-xs text-muted tabular-nums">{c.gameIds.length} games</span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-3 text-sm text-faint">IGDB does not list that game in any collection.</p>
            )
          ) : null}
        </section>

        <section>
          <label htmlFor="series-collection-id" className="font-display text-sm font-bold">
            or · an IGDB collection id
          </label>
          <div className="mt-2 flex gap-2">
            <input id="series-collection-id" inputMode="numeric" value={collectionId} onChange={(e) => setCollectionId(e.target.value)} placeholder="453" className="min-h-11 w-32 rounded-xl border border-border bg-surface px-3 text-sm" data-testid="series-collection-id" />
            <Button type="button" disabled={busy || !Number(collectionId)} onClick={() => seedFrom(Number(collectionId))} data-testid="series-seed">
              {busy ? "Asking IGDB…" : "Propose members"}
            </Button>
          </div>
        </section>

        {error ? <p className="text-sm text-bad">{error}</p> : null}
      </div>
    );
  }

  const kept = seed.candidates.filter((c) => picked.has(c.igdbId)).length;
  return (
    <div className="mt-6" data-testid="series-prune-step">
      <div className="flex flex-col gap-3">
        <div>
          <label htmlFor="series-name" className="text-xs text-muted">
            Name
          </label>
          <input id="series-name" value={name} onChange={(e) => setName(e.target.value)} className="mt-1 min-h-11 w-full rounded-xl border border-border bg-surface px-3 font-display text-base font-bold" data-testid="series-name" />
          <p className="mt-1 text-xs text-faint">/series/{slugify(name) || "…"}</p>
        </div>
        <div>
          <label htmlFor="series-blurb" className="text-xs text-muted">
            Blurb — one line
          </label>
          <input id="series-blurb" value={blurb} onChange={(e) => setBlurb(e.target.value)} maxLength={200} className="mt-1 min-h-11 w-full rounded-xl border border-border bg-surface px-3 text-sm" data-testid="series-blurb" />
        </div>
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-2">
        <p className="mr-auto text-sm text-muted">
          IGDB collection {seed.collection.id} · <span className="text-text tabular-nums">{seed.candidates.length}</span> candidates
          {seed.skipped.length ? <span className="text-faint"> · {seed.skipped.length} skipped by the game_type rule</span> : null}
        </p>
        <button type="button" onClick={() => setPicked(new Set(seed.candidates.map((c) => c.igdbId)))} className="min-h-9 rounded-full border border-border px-3 text-xs text-muted hover:text-text">
          All
        </button>
        <button type="button" onClick={() => setPicked(new Set())} className="min-h-9 rounded-full border border-border px-3 text-xs text-muted hover:text-text">
          None
        </button>
        <button type="button" onClick={() => setPicked(new Set(seed.candidates.filter((c) => c.ownedId).map((c) => c.igdbId)))} className="min-h-9 rounded-full border border-border px-3 text-xs text-muted hover:text-text" data-testid="pick-owned">
          Only owned
        </button>
        <button type="button" onClick={() => setShowSections((s) => !s)} aria-pressed={showSections} className={cx("min-h-9 rounded-full border px-3 text-xs", showSections ? "border-accent text-text" : "border-border text-muted hover:text-text")}>
          Sections
        </button>
      </div>

      <ul className="mt-3 flex flex-col gap-1.5" data-testid="series-candidates">
        {seed.candidates.map((c) => {
          const on = picked.has(c.igdbId);
          return (
            <li key={c.igdbId} data-testid="candidate" data-igdb-id={c.igdbId} className={cx("rounded-xl border p-2", on ? "border-border bg-surface" : "border-dashed border-border/60 opacity-60")}>
              <label className="flex min-h-11 cursor-pointer items-center gap-3">
                <input type="checkbox" checked={on} onChange={() => toggle(c.igdbId)} className="h-5 w-5 shrink-0 accent-accent" data-testid="candidate-check" />
                {c.cover ? <img src={coverUrl(c.cover, "small")} alt="" width={32} height={43} className="h-11 w-8 shrink-0 rounded object-cover" /> : <span className="h-11 w-8 shrink-0 rounded bg-surface-2" />}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{c.name}</span>
                  <span className="block truncate text-xs text-muted">
                    {c.year ?? "—"}
                    {c.variants.length ? ` · +${c.variants.length} port${c.variants.length > 1 ? "s" : ""}/version${c.variants.length > 1 ? "s" : ""}` : ""}
                  </span>
                </span>
                {c.ownedId ? <span className="shrink-0 rounded-md bg-good/15 px-2 py-0.5 text-[11px] text-good">{c.platformLabel}</span> : null}
              </label>
              {showSections && on ? (
                <input
                  value={sections[c.igdbId] ?? ""}
                  onChange={(e) => setSections((s) => ({ ...s, [c.igdbId]: e.target.value }))}
                  list="series-sections"
                  placeholder="Section — Mainline, Spin-offs…"
                  data-testid="candidate-section"
                  className="mt-1.5 min-h-9 w-full rounded-lg border border-border bg-bg px-2 text-xs"
                />
              ) : null}
            </li>
          );
        })}
      </ul>
      <datalist id="series-sections">
        {[...new Set(Object.values(sections).map((s) => s.trim()).filter(Boolean))].map((s) => (
          <option key={s} value={s} />
        ))}
      </datalist>

      {/* Sticky so "Save" is under the thumb after scrolling forty rows. */}
      <div className="sticky bottom-0 mt-4 flex items-center gap-3 border-t border-border bg-bg/95 py-3 backdrop-blur">
        <span className="text-sm text-muted tabular-nums" data-testid="kept-count">
          Keeping {kept} of {seed.candidates.length}
        </span>
        <Button type="button" variant="ghost" onClick={() => setSeed(null)} className="ml-auto">
          Back
        </Button>
        <Button type="button" variant="primary" disabled={busy || !kept} onClick={save} data-testid="save-series">
          {busy ? "Saving…" : "Save series"}
        </Button>
      </div>
      {error ? <p className="pb-3 text-sm text-bad">{error}</p> : null}
    </div>
  );
}
