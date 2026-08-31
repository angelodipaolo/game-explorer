"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button, apiError, cx, day } from "@/components/ui";
import { coverUrl } from "@/components/shelf/cover";
import { MAX_BLURB, seenIdsOf, slugify } from "@/lib/series/shape";

/**
 * The editing surface for one series (GAMEEXPLOR-0020): its details, its
 * entries in order, and the two ways a new entry arrives.
 *
 * It is a separate page rather than an edit mode on `/series/[slug]` for the
 * reason the shelf and `/flip` are separate pages: the series page is the
 * shelf's grid, tuned for browsing a hundred covers across a room, and
 * hanging ▲/▼/×/inline-form on every card would turn the thing you look at
 * into the thing you fiddle with. `/series/new` is the same shape — a
 * desktop-leaning curation tool that still has to work one-handed.
 *
 * Every write here is `fetch` → `apiError` → `router.refresh()`, the pattern
 * every other write surface in this app uses. The server re-renders and the
 * list you are looking at is the list the database holds. The entry list in
 * particular is never mirrored into local state and left to drift — the
 * details form above it is a draft, as a form has to be, and last write wins.
 *
 * **Reorder sends a full permutation.** `reorderEntries` rejects anything that
 * is not exactly the current entry set, which is only safe while this list is
 * the whole series — and it is: there is deliberately no search box, no filter
 * and no paging on this page, unlike the series page it edits. If one is ever
 * added, `move` has to keep sending every id (or go away, the way
 * `QueueList`'s arrows do under a filter).
 */

/** The raw editable columns of one entry, plus what it takes to recognise it. */
export type EditorEntry = {
  id: string;
  igdbId: number | null;
  /** The resolved display name — the catalog's, or the override, or "IGDB #123". */
  name: string;
  /** The override as stored: empty for an entry that is happy with its catalog name. */
  title: string;
  cover: string | null;
  year: number | null;
  section: string;
  note: string;
  sourceUrl: string;
  ownedId: string | null;
  platformLabel: string | null;
};

export type EditorSeries = {
  id: string;
  name: string;
  slug: string;
  blurb: string;
  coverImageId: string;
  position: number;
  seedCollectionId: number | null;
  seedCheckedAt: string | null;
};

type Candidate = {
  igdbId: number;
  name: string;
  cover: string | null;
  year: number | null;
  variants: { igdbId: number; name: string; year: number | null }[];
  ownedId: string | null;
  platformLabel: string | null;
};
type SeedCheck = { collection: { id: number; name: string }; fresh: Candidate[]; skipped: number[]; checkedAt: string };

const field = "min-h-11 w-full rounded-lg border border-border bg-bg px-3 text-base outline-none focus:border-accent";
const label = "text-xs text-muted";

export function SeriesEditor({ series, entries }: { series: EditorSeries; entries: EditorEntry[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  /**
   * `router.refresh()` is not awaitable, so releasing the controls when the
   * response lands re-enables them while the page still shows the *old* order.
   * Two quick taps on ▲ would then build the second permutation from the stale
   * list — a complete, valid permutation that the API accepts and that quietly
   * undoes the first move. A transition stays pending until the refreshed RSC
   * payload commits, which is the moment the arrows are safe again.
   */
  const [refreshing, startRefresh] = useTransition();
  const refresh = () => startRefresh(() => router.refresh());
  const working = busy || refreshing;
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Details, held as a draft so the whole form saves in one PATCH rather than
  // one request per keystroke.
  const [name, setName] = useState(series.name);
  const [slug, setSlug] = useState(series.slug);
  const [blurb, setBlurb] = useState(series.blurb);
  const [coverImageId, setCoverImageId] = useState(series.coverImageId);
  const [position, setPosition] = useState(String(series.position));

  const [editId, setEditId] = useState<string | null>(null);
  const [newTitle, setNewTitle] = useState("");
  const [check, setCheck] = useState<SeedCheck | null>(null);
  const [keep, setKeep] = useState<Set<number>>(new Set());

  /**
   * One request, with the failure surfaced in the page rather than an
   * `alert()`: this page is a form, several of its controls fail for reasons
   * worth reading twice (a slug already taken, a reorder that lost a race),
   * and a modal you have to dismiss to re-read the field is the wrong shape
   * for that. `null` means it failed and the caller should not carry on.
   */
  async function call<T>(url: string, init: RequestInit): Promise<T | null> {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(url, { headers: { "content-type": "application/json" }, ...init });
      if (!res.ok) throw await apiError(res);
      return (await res.json()) as T;
    } catch (e) {
      setError((e as Error).message);
      // The reorder and the removes below send ids that must still exist, so a
      // series changed on another phone fails here. The stale list is still on
      // screen at that point and re-sending it would fail the same way.
      refresh();
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function saveDetails() {
    const wanted = slug.trim() || slugify(name);
    const saved = await call<{ slug: string }>(`/api/series/${series.id}`, {
      method: "PATCH",
      body: JSON.stringify({
        name: name.trim(),
        slug: wanted,
        blurb: blurb.trim() || null,
        coverImageId: coverImageId.trim() || null,
        position: Number(position) || 0,
      }),
    });
    if (!saved) return;
    // The slug *is* the URL. Staying on the old one would leave a page whose
    // every subsequent write still works (they go by id) above an address bar
    // that 404s on reload.
    if (saved.slug !== series.slug) router.replace(`/series/${saved.slug}/edit`);
    else refresh();
    setNotice("Saved.");
  }

  /**
   * Move one entry by a place. Arrows rather than drag-and-drop, for the
   * reason `QueueList` gives: touch dragging with autoscroll is a library and
   * a pile of edge cases, and this is a thing you do a few rows at a time.
   */
  const move = async (i: number, delta: number) => {
    const order = entries.map((e) => e.id);
    const j = i + delta;
    if (j < 0 || j >= order.length) return;
    [order[i], order[j]] = [order[j], order[i]];
    // The whole list, every time — see the note at the top of this file.
    if (await call(`/api/series/${series.id}/entries`, { method: "PATCH", body: JSON.stringify({ orderedIds: order }) })) refresh();
  };

  const removeEntry = async (e: EditorEntry) => {
    if (!confirm(`Remove "${e.name}" from ${series.name}?`)) return;
    if (await call(`/api/series-entries/${e.id}`, { method: "DELETE" })) refresh();
  };

  const saveEntry = async (id: string, body: { title: string | null; section: string | null; note: string | null; sourceUrl: string | null }) => {
    if (!(await call(`/api/series-entries/${id}`, { method: "PATCH", body: JSON.stringify(body) }))) return;
    setEditId(null);
    refresh();
  };

  const addByHand = async () => {
    const title = newTitle.trim();
    if (!title) return;
    // No `igdbId`: a game IGDB has never heard of is a real entry, the same
    // tolerance a null `OwnedGame.catalogGameId` gives a cartridge like Roller
    // Games. It lands at the end of the list and can be moved from there.
    if (!(await call(`/api/series/${series.id}/entries`, { method: "POST", body: JSON.stringify({ entries: [{ title }] }) }))) return;
    setNewTitle("");
    refresh();
  };

  const runSeedCheck = async () => {
    const result = await call<SeedCheck>(`/api/series/${series.id}/seed-check`, { method: "POST" });
    if (!result) return;
    setCheck(result);
    // Everything ticked, as on /series/new: unticking the ports is the smaller job.
    setKeep(new Set(result.fresh.map((c) => c.igdbId)));
    // No banner when there is nothing new: the panel below already says so, and
    // two copies of one sentence read as two different facts.
  };

  /**
   * Accept the review.
   *
   * `seen` is `seenIdsOf(check.fresh)` — every id this screen *showed*, the
   * collapsed ports included, whether it was kept or turned down. That is the
   * whole reason `Series.seenIgdbIds` exists (see `newSinceLastPrune` in
   * src/lib/series/shape.ts): recording only what was kept would offer the
   * rejects again on every check, and recording only the primaries would let a
   * variant come back as its own candidate the day IGDB drops its parent.
   * Everything the collection holds that is *not* in `fresh` was filtered out
   * by `checkSeed` precisely because it is already seen or already an entry,
   * so this covers the offer exactly.
   *
   * Keeping nothing is a real answer and still posts: `addEntriesSchema`
   * accepts an empty `entries` with a non-empty `seen` for exactly this case.
   */
  const applyCheck = async () => {
    // `seenIgdbIds` is append-only by design: `markSeen` unions, and
    // `seriesPatchSchema` omits `seen` so no PATCH can reset it. Turning a
    // candidate down is therefore permanent and there is no un-see anywhere in
    // the app — which is exactly why this asks first, and why deleting the
    // series (recoverable: re-seed it) is not the more guarded of the two.
    const turningDown = check ? check.fresh.length - keep.size : 0;
    if (turningDown && !confirm(keep.size ? `Turn down ${turningDown} of these for good? They will never be offered again.` : `Turn down all ${turningDown} for good? They will never be offered again.`)) return;
    if (!check) return;
    const kept = check.fresh.filter((c) => keep.has(c.igdbId));
    const result = await call<{ added: unknown[]; skipped: unknown[] }>(`/api/series/${series.id}/entries`, {
      method: "POST",
      body: JSON.stringify({ entries: kept.map((c) => ({ igdbId: c.igdbId })), seen: seenIdsOf(check.fresh) }),
    });
    if (!result) return;
    setCheck(null);
    setKeep(new Set());
    setNotice(kept.length ? `Added ${kept.length}.` : "Recorded — those will not be offered again.");
    refresh();
  };

  const deleteSeries = async () => {
    if (!confirm(`Delete the series "${series.name}" and its ${entries.length} ${entries.length === 1 ? "entry" : "entries"}? This cannot be undone.`)) return;
    if (!(await call(`/api/series/${series.id}`, { method: "DELETE" }))) return;
    router.push("/series");
    refresh();
  };

  const toggleKeep = (igdbId: number) =>
    setKeep((prev) => {
      const next = new Set(prev);
      if (next.has(igdbId)) next.delete(igdbId);
      else next.add(igdbId);
      return next;
    });

  return (
    <div className="flex flex-col gap-8" data-testid="series-editor">
      {/* Sticky so the two messages are readable wherever you are in a
          300-entry list — a failed reorder halfway down is otherwise reported
          off the top of the screen. */}
      {error || notice ? (
        <div className="sticky top-2 z-10">
          {error ? (
            <p className="rounded-xl border border-bad/30 bg-bad/10 px-3 py-2 text-sm text-bad" data-testid="editor-error">
              {error}
            </p>
          ) : (
            <p className="rounded-xl border border-good/30 bg-good/10 px-3 py-2 text-sm text-good" data-testid="editor-notice">
              {notice}
            </p>
          )}
        </div>
      ) : null}

      <section data-testid="series-details">
        <h2 className="font-display text-base font-bold">Details</h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className={cx(label, "sm:col-span-2")}>
            Name
            <input value={name} onChange={(e) => setName(e.target.value)} maxLength={120} className={cx(field, "mt-1 font-display font-bold")} data-testid="details-name" />
          </label>
          <label className={label}>
            Slug — the URL
            <input value={slug} onChange={(e) => setSlug(e.target.value)} maxLength={80} placeholder={slugify(name)} className={cx(field, "mt-1")} data-testid="details-slug" />
            <span className="mt-1 block text-xs text-faint">/series/{slug.trim() || slugify(name) || "…"}</span>
          </label>
          <label className={label}>
            Position — where it sorts on /series
            <input value={position} onChange={(e) => setPosition(e.target.value.replace(/[^0-9]/g, ""))} inputMode="numeric" className={cx(field, "mt-1 tabular-nums")} data-testid="details-position" />
          </label>
          <label className={cx(label, "sm:col-span-2")}>
            Blurb — one line
            <input value={blurb} onChange={(e) => setBlurb(e.target.value)} maxLength={MAX_BLURB} className={cx(field, "mt-1")} data-testid="details-blurb" />
            <span className="mt-1 block text-xs text-faint tabular-nums">
              {blurb.length} / {MAX_BLURB}
            </span>
          </label>
          <label className={cx(label, "sm:col-span-2")}>
            Cover — an IGDB image id, overriding the one derived from the first entry
            <div className="mt-1 flex items-start gap-3">
              <input value={coverImageId} onChange={(e) => setCoverImageId(e.target.value)} maxLength={64} placeholder="co1r76" className={cx(field, "flex-1")} data-testid="details-cover" />
              {/* There is deliberately no upload path: a series is its games,
                  and deriving the cover from one of them is free. The field is
                  the escape hatch for when the derived one picks something odd. */}
              {coverImageId.trim() ? <img src={coverUrl(coverImageId.trim(), "small")} alt="" width={44} height={59} className="h-[59px] w-11 shrink-0 rounded object-cover" /> : null}
            </div>
          </label>
        </div>
        <div className="mt-3 flex items-center gap-2">
          <Button type="button" variant="primary" disabled={working || !name.trim()} onClick={saveDetails} data-testid="save-details">
            {working ? "Saving…" : "Save details"}
          </Button>
          <Link href={`/series/${series.slug}`} className="min-h-11 px-2 py-2.5 text-sm text-muted hover:text-text" prefetch={false}>
            View the series
          </Link>
        </div>
      </section>

      <section data-testid="series-entry-list">
        <h2 className="font-display text-base font-bold">
          Entries <span className="text-muted tabular-nums">· {entries.length}</span>
        </h2>
        <p className="mt-1 text-xs text-muted">In order. ▲ / ▼ move an entry; Edit gives it a section, a note, a source, or a name of its own.</p>

        {entries.length ? (
          <ul className="mt-3 flex flex-col gap-1.5" data-testid="entry-rows">
            {entries.map((e, i) =>
              editId === e.id ? (
                <li key={e.id}>
                  <EntryForm entry={e} busy={busy} onCancel={() => setEditId(null)} onSave={(body) => saveEntry(e.id, body)} />
                </li>
              ) : (
                <li key={e.id} className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-surface p-2" data-testid="entry-row" data-entry-id={e.id}>
                  {/* Wraps at 390px: the name and four controls cannot share a
                      line there without truncating the name to "Final Fa…". */}
                  <div className="flex min-w-0 basis-full items-center gap-3 sm:basis-0 sm:flex-1">
                    <span className="w-6 shrink-0 text-right text-xs text-faint tabular-nums">{i + 1}</span>
                    {e.cover ? <img src={coverUrl(e.cover, "small")} alt="" width={32} height={43} className="h-11 w-8 shrink-0 rounded object-cover" /> : <span className="h-11 w-8 shrink-0 rounded bg-surface-2" />}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium" data-testid="entry-name">
                        {e.name}
                      </span>
                      <span className="block truncate text-xs text-muted">
                        {e.year ?? "—"}
                        {e.section ? ` · ${e.section}` : ""}
                        {e.note ? ` · ${e.note}` : ""}
                        {e.sourceUrl ? " · sourced" : ""}
                      </span>
                    </span>
                    {e.ownedId ? <span className="shrink-0 rounded-md bg-good/15 px-2 py-0.5 text-[11px] text-good">{e.platformLabel}</span> : <span className="shrink-0 rounded-md bg-surface-2 px-2 py-0.5 text-[11px] text-muted">not owned</span>}
                  </div>
                  <div className="ml-auto flex shrink-0 items-center gap-1">
                    <button onClick={() => move(i, -1)} disabled={working || i === 0} className="h-11 w-11 rounded-lg border border-border text-sm text-muted hover:border-muted hover:text-text disabled:opacity-30" aria-label={`Move ${e.name} up`} data-testid="entry-up">
                      ▲
                    </button>
                    <button onClick={() => move(i, 1)} disabled={working || i === entries.length - 1} className="h-11 w-11 rounded-lg border border-border text-sm text-muted hover:border-muted hover:text-text disabled:opacity-30" aria-label={`Move ${e.name} down`} data-testid="entry-down">
                      ▼
                    </button>
                    <button onClick={() => setEditId(e.id)} disabled={working} className="min-h-11 rounded-lg border border-border px-3 text-sm text-muted hover:border-muted hover:text-text disabled:opacity-40" aria-label={`Edit ${e.name}`} data-testid="entry-edit">
                      Edit
                    </button>
                    <button onClick={() => removeEntry(e)} disabled={working} className="h-11 w-11 rounded-lg border border-border text-lg text-muted hover:border-muted hover:text-text disabled:opacity-40" aria-label={`Remove ${e.name}`} data-testid="entry-remove">
                      ×
                    </button>
                  </div>
                </li>
              ),
            )}
          </ul>
        ) : (
          <p className="mt-3 rounded-xl border border-dashed border-border px-4 py-8 text-center text-sm text-muted" data-testid="entries-empty">
            No entries yet. Type one below, or check the IGDB collection this was seeded from.
          </p>
        )}

        {/* The sections already in use, so the second "Spin-offs" is picked
            rather than retyped — a section is grouped by its exact text. */}
        <datalist id="series-entry-sections">
          {[...new Set(entries.map((e) => e.section.trim()).filter(Boolean))].map((s) => (
            <option key={s} value={s} />
          ))}
        </datalist>

        <div className="mt-3 flex flex-wrap items-end gap-2">
          <label className={cx(label, "min-w-0 flex-1")}>
            Add an entry by hand
            <input
              value={newTitle}
              onChange={(ev) => setNewTitle(ev.target.value)}
              onKeyDown={(ev) => {
                if (ev.key === "Enter") void addByHand();
              }}
              maxLength={200}
              placeholder="A game IGDB has never heard of…"
              className={cx(field, "mt-1")}
              data-testid="new-entry-title"
            />
          </label>
          <Button type="button" disabled={working || !newTitle.trim()} onClick={addByHand} data-testid="add-entry">
            Add
          </Button>
        </div>
      </section>

      <section data-testid="series-seed">
        <h2 className="font-display text-base font-bold">The seed</h2>
        {series.seedCollectionId != null ? (
          <>
            <p className="mt-1 text-xs text-muted">
              IGDB collection <span className="tabular-nums">{series.seedCollectionId}</span>
              {series.seedCheckedAt ? ` · last checked ${day(series.seedCheckedAt)}` : " · never checked"}. A check only ever reports; nothing merges on its own.
            </p>
            <Button type="button" className="mt-2" disabled={busy} onClick={runSeedCheck} data-testid="seed-check">
              {busy ? "Asking IGDB…" : "Check for new entries"}
            </Button>
          </>
        ) : (
          // No collection to diff against: this series was started empty or its
          // seed was cleared. Saying so beats a button that always 400s.
          <p className="mt-1 text-xs text-muted" data-testid="seed-none">
            This series was not seeded from an IGDB collection, so there is nothing to check it against. Entries are added by hand above.
          </p>
        )}

        {check ? (
          <div className="mt-3 rounded-xl border border-border bg-bg-elev p-3" data-testid="seed-check-review">
            {check.fresh.length ? (
              <>
                <p className="text-sm text-muted">
                  <span className="text-text tabular-nums">{check.fresh.length}</span> new in {check.collection.name} since the last check. Keep the ones that belong — the rest are recorded as turned down and will not be offered again.
                </p>
                <ul className="mt-2 flex flex-col gap-1.5" data-testid="seed-candidates">
                  {check.fresh.map((c) => {
                    const on = keep.has(c.igdbId);
                    return (
                      <li key={c.igdbId} data-testid="seed-candidate" data-igdb-id={c.igdbId} className={cx("rounded-xl border p-2", on ? "border-border bg-surface" : "border-dashed border-border/60 opacity-60")}>
                        <label className="flex min-h-11 cursor-pointer items-center gap-3">
                          <input type="checkbox" checked={on} onChange={() => toggleKeep(c.igdbId)} className="h-5 w-5 shrink-0 accent-accent" data-testid="seed-candidate-check" />
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
                      </li>
                    );
                  })}
                </ul>
              </>
            ) : (
              <p className="text-sm text-muted" data-testid="seed-check-empty">
                Nothing new in {check.collection.name}.{check.skipped.length ? ` ${check.skipped.length} member${check.skipped.length > 1 ? "s were" : " was"} skipped by the game_type rule.` : ""}
              </p>
            )}
            <div className="mt-3 flex flex-wrap items-center gap-2">
              {check.fresh.length ? (
                <Button type="button" variant="primary" disabled={working} onClick={applyCheck} data-testid="seed-apply">
                  {keep.size ? `Add ${keep.size}, turn down ${check.fresh.length - keep.size}` : `Turn down all ${check.fresh.length}`}
                </Button>
              ) : null}
              <Button
                type="button"
                variant="ghost"
                disabled={busy}
                onClick={() => {
                  setCheck(null);
                  setKeep(new Set());
                }}
                data-testid="seed-dismiss"
              >
                {/* Closing without answering records nothing: these ids stay
                    unseen and come back on the next check, which is the honest
                    outcome for "I have not decided yet". */}
                {check.fresh.length ? "Decide later" : "Close"}
              </Button>
            </div>
          </div>
        ) : null}
      </section>

      <section>
        <h2 className="font-display text-base font-bold">Danger</h2>
        <p className="mt-1 max-w-prose text-xs text-muted">Deleting the series takes its entries with it. Nothing on the shelf is touched — a series only ever points at games.</p>
        <Button type="button" variant="danger" className="mt-2" disabled={working} onClick={deleteSeries} data-testid="delete-series">
          Delete this series
        </Button>
      </section>
    </div>
  );
}

type EntryBody = { title: string | null; section: string | null; note: string | null; sourceUrl: string | null };

/**
 * The inline editor for one entry, modelled on `BookmarkForm`: the row becomes
 * the form in place, rather than a modal that hides the order you are working
 * on.
 *
 * `title` is an **override**, not the name: an entry with an IGDB id already
 * shows the catalog's name, and this is for the cases the catalog spells
 * oddly. For a free-text entry it is the only name there is, which is why
 * `updateEntry` refuses to blank it — the form does the same client-side so
 * the refusal is a disabled button rather than a round trip.
 */
function EntryForm({ entry, busy, onCancel, onSave }: { entry: EditorEntry; busy: boolean; onCancel: () => void; onSave: (body: EntryBody) => void }) {
  const [title, setTitle] = useState(entry.title);
  const [section, setSection] = useState(entry.section);
  const [note, setNote] = useState(entry.note);
  const [sourceUrl, setSourceUrl] = useState(entry.sourceUrl);
  const needsTitle = entry.igdbId == null;

  return (
    <form
      onSubmit={(ev) => {
        ev.preventDefault();
        onSave({ title: title.trim() || null, section: section.trim() || null, note: note.trim() || null, sourceUrl: sourceUrl.trim() || null });
      }}
      className="rounded-xl border border-accent/40 bg-bg-elev p-3"
      data-testid="entry-form"
    >
      <p className="mb-2 text-xs text-faint">{entry.igdbId != null ? `IGDB #${entry.igdbId} · ${entry.name}` : "Typed in by hand — no IGDB id"}</p>
      <div className="grid gap-2 sm:grid-cols-2">
        <label className={cx(label, "sm:col-span-2")}>
          {needsTitle ? "Title" : "Title — overrides the catalog's name"}
          <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} required={needsTitle} placeholder={needsTitle ? "" : entry.name} className={cx(field, "mt-1")} aria-label="Title" data-testid="entry-title" />
        </label>
        <label className={label}>
          Section
          <input value={section} onChange={(e) => setSection(e.target.value)} maxLength={60} list="series-entry-sections" placeholder="Mainline, Spin-offs…" className={cx(field, "mt-1")} aria-label="Section" data-testid="entry-section" />
        </label>
        <label className={label}>
          Note
          <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} placeholder="Japan only, never localised" className={cx(field, "mt-1")} aria-label="Note" data-testid="entry-note" />
        </label>
        <label className={cx(label, "sm:col-span-2")}>
          Source
          <input value={sourceUrl} onChange={(e) => setSourceUrl(e.target.value)} type="url" inputMode="url" maxLength={500} placeholder="https://…" className={cx(field, "mt-1")} aria-label="Source" data-testid="entry-source" />
        </label>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button type="submit" disabled={busy || (needsTitle && !title.trim())} className="min-h-11 rounded-lg bg-accent px-4 text-sm font-semibold text-accent-ink disabled:opacity-40" data-testid="entry-save">
          Save
        </button>
        <button type="button" onClick={onCancel} disabled={busy} className="min-h-11 rounded-lg border border-border px-4 text-sm text-muted hover:border-muted hover:text-text">
          Cancel
        </button>
      </div>
    </form>
  );
}
