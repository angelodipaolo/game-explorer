"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { GameBookmark } from "@prisma/client";
import { BOOKMARK_KINDS, KIND_LABELS, KIND_OPTIONS, MAX_BOOKMARKS_PER_GAME, hostOf, kindRank, type BookmarkKind } from "@/lib/bookmarks/kinds";
import { cx } from "@/components/ui";
import { Section, openSection } from "@/components/game/section";

/**
 * Reference links on a game page, grouped by kind. Read-only until you press
 * "+ link".
 *
 * Every row looks the same whoever added it — no provenance badges, because a
 * link pasted in by hand and one the find-references skill found are the same
 * kind of record. The `why` line under each title is the whole point: a list
 * of bare URLs is a bookmarks folder nobody opens twice.
 *
 * Each row is one outbound anchor covering the title and the why, so the tap
 * target is the card rather than a word in it. Edit sits beside it as its own
 * button, outside the link — nesting a button inside an anchor is invalid and
 * makes the tap ambiguous on a phone.
 */
export function Bookmarks({ gameId, bookmarks, canEdit }: { gameId: string; bookmarks: GameBookmark[]; canEdit: boolean }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [adding, setAdding] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function call(method: "POST" | "PATCH" | "DELETE", body: object | null, bookmarkId?: string) {
    setBusy(true);
    try {
      const url = bookmarkId ? `/api/bookmarks/${bookmarkId}` : `/api/games/${gameId}/bookmarks`;
      const res = await fetch(url, { method, headers: { "content-type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) });
      if (!res.ok) throw new Error((await res.json()).error ?? res.status);
      setAdding(false);
      setEditId(null);
      router.refresh();
      return true;
    } catch (e) {
      alert((e as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  }

  const groups: { kind: string; rows: GameBookmark[] }[] = BOOKMARK_KINDS.map((kind) => ({ kind: kind as string, rows: bookmarks.filter((b) => b.kind === kind) })).filter((g) => g.rows.length);
  // A bookmark written with a kind this build no longer knows about still shows.
  for (const b of bookmarks) {
    if (kindRank(b.kind) < BOOKMARK_KINDS.length) continue;
    const g = groups.find((x) => x.kind === b.kind);
    if (g) g.rows.push(b);
    else groups.push({ kind: b.kind, rows: [b] });
  }
  const full = bookmarks.length >= MAX_BOOKMARKS_PER_GAME;

  const editButton =
    bookmarks.length && canEdit ? (
      <button onClick={() => setEditing((e) => !e)} className="tap-44 min-h-8 rounded-full border border-border px-3 text-xs text-muted hover:border-muted hover:text-text" data-testid="edit-bookmarks">
        {editing ? "Done" : "Edit"}
      </button>
    ) : null;

  // Empty stays a single quiet row at rest, "+ link" in the header rather
  // than an open drawer of onboarding copy (GAMEEXPLOR-0023 round 2, item E).
  const emptyAddButton =
    !bookmarks.length && canEdit ? (
      <button
        onClick={() => {
          openSection("guides");
          setAdding(true);
        }}
        className="tap-44 min-h-8 rounded-full border border-border px-3 text-xs text-muted hover:border-muted hover:text-text"
        data-testid="add-bookmark-empty"
      >
        + link
      </button>
    ) : null;

  return (
    // Capped width: a title and its why-line should read as one paragraph
    // rather than stretch across a desktop monitor.
    <Section
      id="guides"
      title="Guides & links"
      count={bookmarks.length}
      testId="bookmarks"
      collapsible
      defaultOpen={bookmarks.length > 0 && bookmarks.length <= 3}
      storageKey="guides"
      action={editButton}
      emptyAction={emptyAddButton}
      className="max-w-3xl"
    >
      {groups.map((g) => (
        <div key={g.kind} className="mb-4">
          <h3 className="mb-2 font-display text-sm font-bold text-muted">{KIND_LABELS[g.kind as BookmarkKind] ?? g.kind}</h3>
          <ul className="flex flex-col gap-2">
            {g.rows.map((b) =>
              editId === b.id ? (
                <li key={b.id}>
                  <BookmarkForm
                    initial={b}
                    busy={busy}
                    onCancel={() => setEditId(null)}
                    onSubmit={(body) => call("PATCH", body, b.id)}
                    onDelete={() => {
                      if (confirm(`Remove "${b.title}"?`)) void call("DELETE", null, b.id);
                    }}
                  />
                </li>
              ) : (
                <BookmarkRow key={b.id} bookmark={b} editing={editing && canEdit} busy={busy} onEdit={() => setEditId(b.id)} />
              ),
            )}
          </ul>
        </div>
      ))}

      {adding && canEdit ? (
        <BookmarkForm busy={busy} onCancel={() => setAdding(false)} onSubmit={(body) => call("POST", body)} />
      ) : canEdit ? (
        <button
          onClick={() => setAdding(true)}
          disabled={full}
          title={full ? `A game holds at most ${MAX_BOOKMARKS_PER_GAME} links` : undefined}
          className="min-h-11 rounded-xl border border-dashed border-border px-4 text-sm text-muted hover:border-muted hover:text-text disabled:opacity-40"
          data-testid="add-bookmark"
        >
          + link
        </button>
      ) : null}
      {!bookmarks.length && !adding ? <p className="mt-2 text-xs text-faint">The guide, the wiki, the longplay — with a line saying why that one.</p> : null}
    </Section>
  );
}

function BookmarkRow({ bookmark: b, editing, busy, onEdit }: { bookmark: GameBookmark; editing: boolean; busy: boolean; onEdit: () => void }) {
  return (
    <li className="flex items-stretch gap-2" data-testid="bookmark-row">
      <a
        href={b.url}
        target="_blank"
        rel="noreferrer"
        className="min-w-0 flex-1 rounded-xl border border-border bg-surface p-3 transition hover:border-muted hover:bg-surface-2"
        data-testid="bookmark-link"
      >
        <div className="flex items-start justify-between gap-2">
          <span className="min-w-0 text-sm font-medium">{b.title}</span>
          <span aria-hidden className="shrink-0 text-faint">
            ↗
          </span>
        </div>
        <div className="mt-1 text-xs leading-relaxed text-muted">{b.why}</div>
        {b.note ? <div className="mt-1 text-xs text-faint">{b.note}</div> : null}
        <div className="mt-1 truncate text-[11px] text-faint">{hostOf(b.url)}</div>
      </a>
      {editing ? (
        <button onClick={onEdit} disabled={busy} className="min-h-11 min-w-11 shrink-0 self-center rounded-lg border border-border px-2 text-xs text-muted hover:border-muted hover:text-text" aria-label={`Edit ${b.title}`}>
          Edit
        </button>
      ) : null}
    </li>
  );
}

type FormBody = { kind: string; url: string; title: string; why: string; note: string | null };

function BookmarkForm({ initial, busy, onCancel, onSubmit, onDelete }: { initial?: GameBookmark; busy: boolean; onCancel: () => void; onSubmit: (body: FormBody) => Promise<boolean>; onDelete?: () => void }) {
  const [kind, setKind] = useState<string>(initial?.kind ?? "guide");
  const [url, setUrl] = useState(initial?.url ?? "");
  const [title, setTitle] = useState(initial?.title ?? "");
  const [why, setWhy] = useState(initial?.why ?? "");
  const [note, setNote] = useState(initial?.note ?? "");

  const field = "min-h-11 w-full rounded-lg border border-border bg-bg px-3 text-base outline-none focus:border-accent";
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void onSubmit({ kind, url: url.trim(), title: title.trim(), why: why.trim(), note: note.trim() || null });
      }}
      className="rounded-xl border border-border bg-bg-elev p-3"
      data-testid="bookmark-form"
    >
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="text-xs text-muted">
          Kind
          <select value={kind} onChange={(e) => setKind(e.target.value)} className={cx(field, "mt-1")} aria-label="Kind" data-testid="bookmark-kind">
            {BOOKMARK_KINDS.map((k) => (
              <option key={k} value={k}>
                {KIND_OPTIONS[k]}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs text-muted">
          Link
          <input value={url} onChange={(e) => setUrl(e.target.value)} type="url" inputMode="url" placeholder="https://…" required className={cx(field, "mt-1")} aria-label="Link" data-testid="bookmark-url" />
        </label>
        <label className="text-xs text-muted sm:col-span-2">
          Title
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Contra — FAQ/Walkthrough by CyricZ" required className={cx(field, "mt-1")} aria-label="Title" data-testid="bookmark-title" />
        </label>
        <label className="text-xs text-muted sm:col-span-2">
          Why this one
          <input value={why} onChange={(e) => setWhy(e.target.value)} placeholder="Covers the NES release stage by stage, with the 30-lives code up front" required className={cx(field, "mt-1")} aria-label="Why this one" data-testid="bookmark-why" />
        </label>
        <label className="text-xs text-muted sm:col-span-2">
          Note
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Anything else worth knowing" className={cx(field, "mt-1")} aria-label="Note" />
        </label>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button type="submit" disabled={busy || !url.trim() || !title.trim() || !why.trim()} className="min-h-11 rounded-lg bg-accent px-4 text-sm font-semibold text-accent-ink disabled:opacity-40" data-testid="save-bookmark">
          Save
        </button>
        <button type="button" onClick={onCancel} disabled={busy} className="min-h-11 rounded-lg border border-border px-4 text-sm text-muted hover:border-muted hover:text-text">
          Cancel
        </button>
        {onDelete ? (
          <button type="button" onClick={onDelete} disabled={busy} className="ml-auto min-h-11 rounded-lg border border-bad/30 bg-bad/10 px-4 text-sm text-bad hover:bg-bad/20" data-testid="delete-bookmark">
            Remove
          </button>
        ) : null}
      </div>
    </form>
  );
}
