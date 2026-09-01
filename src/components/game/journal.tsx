"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import type { JournalEntry, PlaySession } from "@prisma/client";
import { apiError, cx, day, dateInput } from "@/components/ui";
import { Overlay, focusTrigger } from "@/components/overlay";
import { Section, openSection } from "@/components/game/section";

/**
 * The game journal: dated notes and photos about this copy, newest first.
 * The heaviest section on the page, so it gets the most restructuring:
 *
 *   1. The composer sits behind a "＋ Add a note" button, matching the
 *      "+ code" / "+ link" affordance elsewhere — it used to be permanently
 *      expanded, ~250px even with zero entries.
 *   2. Only the 3 most recent entries render; "Show all N" reveals the rest.
 *   3. An entry's body clamps to 3 lines; tapping it expands in place.
 *   4. Photo thumbnails are a fixed 96px square — they used to render at
 *      their natural size and dominate the feed.
 *
 * The one thing that must not be hidden magic is the run link. While a run is
 * open, everything you write defaults to it — that default is the whole reason
 * `JournalEntry.sessionId` exists — so it shows as a chip you can see and
 * clear, never as a silent behaviour.
 *
 * Photos are downscaled in the browser before they are uploaded (2400px long
 * edge, JPEG q0.85). A modern phone photo is 4-6 MB; a few hundred of those is
 * a `data/` directory nobody wants to back up over wifi.
 */

/** Long-edge ceiling for an uploaded photo, in pixels. */
export const MAX_EDGE = 2400;
const QUALITY = 0.85;

/** Entries shown before the "Show all N" expander. */
const FOLD = 3;

/**
 * `imageOrientation: "from-image"` bakes the EXIF rotation into the pixels. A
 * photo off an iPhone is stored landscape with a "rotate 90" tag, and the
 * canvas re-encode below drops tags — so without this every held-up-phone
 * screenshot lands in the journal sideways. The options form is not universal;
 * a browser that rejects it decodes unrotated rather than not at all.
 */
async function decode(file: File): Promise<ImageBitmap> {
  try {
    return await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    return await createImageBitmap(file);
  }
}

async function downscale(file: File): Promise<Blob> {
  try {
    const bmp = await decode(file);
    const longEdge = Math.max(bmp.width, bmp.height);
    // Already small and already a photo format: send the bytes as they are.
    // Re-encoding a PNG as JPEG smears the pixel art it was kept for, and
    // re-encoding a small JPEG is a second generation of loss for no saving.
    // Both keep their own EXIF, which the browser honours when it renders them.
    if (longEdge <= MAX_EDGE && (file.type === "image/png" || file.type === "image/jpeg") && file.size <= 2_000_000) {
      bmp.close();
      return file;
    }
    const scale = Math.min(1, MAX_EDGE / longEdge);
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bmp.width * scale);
    canvas.height = Math.round(bmp.height * scale);
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    bmp.close();
    const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, "image/jpeg", QUALITY));
    return blob ?? file;
  } catch {
    // A format the browser cannot decode: let the server sniff and reject it.
    return file;
  }
}

export function Journal({ gameId, entries, sessions, canEdit }: { gameId: string; entries: JournalEntry[]; sessions: PlaySession[]; canEdit: boolean }) {
  const router = useRouter();
  const openRun = sessions.find((s) => !s.endedAt) ?? null;
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [composerOpen, setComposerOpen] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [when, setWhen] = useState(dateInput());
  const [onRun, setOnRun] = useState(true);
  const [file, setFile] = useState<File | null>(null);
  const [viewing, setViewing] = useState<JournalEntry | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const closePhoto = useRef<HTMLButtonElement>(null);

  async function add() {
    if (!file && !body.trim()) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/games/${gameId}/journal`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ kind: file ? "photo" : "note", title: title.trim() || null, body: body.trim() || null, occurredAt: when, sessionId: openRun && onRun ? openRun.id : null }),
      });
      if (!res.ok) throw await apiError(res);
      const entry: JournalEntry = await res.json();
      if (file) {
        // Two steps, like maps: the row, then the bytes. A JSON body and a
        // multi-megabyte photo do not belong in one request.
        const blob = await downscale(file);
        const put = await fetch(`/api/journal/${entry.id}/image`, { method: "PUT", headers: { "content-type": blob.type || "image/jpeg" }, body: blob });
        if (!put.ok) {
          // The bytes were rejected (wrong format, too big, connection gone),
          // which leaves a photo entry with no photo — a "photo not uploaded"
          // row that every retry would duplicate. The row only exists to hang
          // the bytes on, so it goes back with them.
          const failed = await apiError(put);
          await fetch(`/api/journal/${entry.id}`, { method: "DELETE" }).catch(() => {});
          throw failed;
        }
      }
      setTitle("");
      setBody("");
      setFile(null);
      setWhen(dateInput());
      if (fileRef.current) fileRef.current.value = "";
      setComposerOpen(false);
      router.refresh();
    } catch (e) {
      alert((e as Error).message);
      // Resync either way: the write may have failed because this view is stale
      // (the run was finished in another tab), and the rollback above changed
      // what the server will now send.
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function remove(entry: JournalEntry) {
    if (!confirm("Delete this entry?")) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/journal/${entry.id}`, { method: "DELETE" });
      if (!res.ok) throw await apiError(res);
      router.refresh();
    } catch (e) {
      alert((e as Error).message);
      // Someone else may have deleted it already; refresh rather than leave a
      // row on screen that is no longer there.
      router.refresh();
    } finally {
      setBusy(false);
    }
  }


  const visible = showAll ? entries : entries.slice(0, FOLD);
  // Entries sit under the run they were written during once there is more than
  // one run to tell apart; a single run (or none) is a flat feed.
  const groups = sessions.length > 1 ? groupByRun(visible, sessions) : [{ key: "all", heading: null, rows: visible }];
  const field = "min-h-11 w-full rounded-lg border border-border bg-bg px-3 text-base outline-none focus:border-accent";

  const editButton =
    entries.length && canEdit ? (
      <button onClick={() => setEditing((e) => !e)} className="tap-44 min-h-8 rounded-full border border-border px-3 text-xs text-muted hover:border-muted hover:text-text" data-testid="edit-journal">
        {editing ? "Done" : "Edit"}
      </button>
    ) : null;

  // Nothing written yet stays a quiet closed row, "＋ Add a note" in the
  // header instead of an open drawer of onboarding copy (GAMEEXPLOR-0023
  // round 2, item E) — jumps straight to the composer.
  const emptyAddButton =
    !entries.length && canEdit ? (
      <button
        onClick={() => {
          openSection("journal");
          setComposerOpen(true);
        }}
        className="tap-44 min-h-8 rounded-full border border-border px-3 text-xs text-muted hover:border-muted hover:text-text"
        data-testid="journal-add-note-empty"
      >
        ＋ Add a note
      </button>
    ) : null;

  return (
    <Section
      id="journal"
      title="Journal"
      count={entries.length}
      testId="journal"
      collapsible
      defaultOpen={entries.length > 0}
      storageKey="journal"
      action={editButton}
      emptyAction={emptyAddButton}
      className="max-w-3xl"
    >
      {canEdit ? (
        composerOpen ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void add();
            }}
            className="rounded-xl border border-border bg-bg-elev p-3"
            data-testid="journal-composer"
          >
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={3}
              placeholder="Where you got to, what happened, what to remember next time"
              aria-label="Journal entry"
              className="w-full rounded-lg border border-border bg-bg p-3 text-base outline-none focus:border-accent"
              data-testid="journal-body"
              autoFocus
            />
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title (optional)" aria-label="Title" className={field} data-testid="journal-title" />
              <input type="date" value={when} onChange={(e) => setWhen(e.target.value)} aria-label="When it happened" className={field} data-testid="journal-date" />
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              {/* No `capture`: the screenshot is already in the camera roll. */}
              <input ref={fileRef} type="file" accept="image/*" onChange={(e) => setFile(e.target.files?.[0] ?? null)} aria-label="Add photo" className="min-h-11 max-w-full text-xs text-muted file:mr-2 file:min-h-9 file:rounded-lg file:border file:border-border file:bg-surface file:px-3 file:text-sm file:text-text" data-testid="journal-photo" />
              {file ? <span className="text-xs text-accent-2">{file.name}</span> : null}
            </div>
            {openRun ? (
              <div className="mt-2 flex flex-wrap items-center gap-2">
                {onRun ? (
                  <span className="inline-flex min-h-8 items-center gap-1 rounded-full bg-accent/15 px-3 text-xs text-accent" data-testid="journal-run-chip">
                    on this run · since {day(openRun.startedAt)}
                    <button type="button" onClick={() => setOnRun(false)} className="ml-1 rounded-full px-1 leading-none hover:bg-bg/40" aria-label="Not part of this run" data-testid="journal-clear-run">
                      ×
                    </button>
                  </span>
                ) : (
                  <button type="button" onClick={() => setOnRun(true)} className="tap-44 min-h-8 rounded-full border border-dashed border-border px-3 text-xs text-muted hover:border-muted hover:text-text" data-testid="journal-set-run">
                    + file under this run
                  </button>
                )}
              </div>
            ) : null}
            <div className="mt-2 flex items-center gap-2">
              <button type="submit" disabled={busy || (!body.trim() && !file)} className="min-h-11 rounded-lg bg-accent px-4 text-sm font-semibold text-accent-ink disabled:opacity-40" data-testid="journal-save">
                {busy ? "Saving…" : file ? "Add photo" : "Add note"}
              </button>
              <button
                type="button"
                onClick={() => {
                  setComposerOpen(false);
                  setTitle("");
                  setBody("");
                  setFile(null);
                  if (fileRef.current) fileRef.current.value = "";
                }}
                disabled={busy}
                className="min-h-11 rounded-lg border border-border px-4 text-sm text-muted hover:border-muted hover:text-text"
              >
                Cancel
              </button>
              <span className="text-xs text-faint">A photo needs no words; a note does.</span>
            </div>
          </form>
        ) : (
          <button onClick={() => setComposerOpen(true)} className="min-h-11 rounded-xl border border-dashed border-border px-4 text-sm text-muted hover:border-muted hover:text-text" data-testid="journal-add-note">
            ＋ Add a note
          </button>
        )
      ) : null}

      {groups.map((g) => (
        <div key={g.key} className="mt-4">
          {g.heading ? <h3 className="mb-2 font-display text-sm font-bold text-muted">{g.heading}</h3> : null}
          <ul className="flex flex-col gap-3">
            {g.rows.map((e) => (
              <JournalEntryCard key={e.id} entry={e} editing={editing} canEdit={canEdit} busy={busy} onDelete={() => remove(e)} onOpenPhoto={() => setViewing(e)} />
            ))}
          </ul>
        </div>
      ))}

      {entries.length > FOLD ? (
        <button onClick={() => setShowAll((s) => !s)} className="mt-3 min-h-11 text-xs text-muted underline hover:text-text" data-testid="journal-show-all">
          {showAll ? "Show fewer" : `Show all ${entries.length}`}
        </button>
      ) : null}

      {!entries.length ? <p className="mt-3 text-xs text-faint">Nothing written yet. Notes and photos stay with the run they were written during.</p> : null}

      {/* The photo overlay is a real dialog now (GAMEEXPLOR-0023): Escape
          closes it, Tab stays inside it, the feed behind it neither scrolls nor
          takes a tap, and closing puts focus back on the thumbnail. All of that
          is `Overlay`, shared with the menu, the filter sheet and the
          screenshot viewer. */}
      <Overlay open={!!viewing} onClose={() => setViewing(null)} label={viewing?.title ?? "Photo"} className="z-50 flex flex-col bg-black/95" initialFocus={closePhoto} testId="journal-photo-viewer">
        <div className="flex items-center justify-between gap-3 px-4 py-3 text-sm text-white/80">
          <span className="min-w-0 truncate">
            {viewing?.title ? `${viewing.title} · ` : ""}
            {viewing ? day(viewing.occurredAt) : ""}
          </span>
          <button ref={closePhoto} onClick={() => setViewing(null)} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-white/20 text-xl text-white" aria-label="Close photo" data-testid="journal-photo-close">
            ×
          </button>
        </div>
        <div className="flex min-h-0 flex-1 items-center justify-center p-3">
          {viewing ? <img src={`/api/journal/${viewing.id}/image`} alt={viewing.title ?? ""} className="max-h-full max-w-full object-contain" /> : null}
        </div>
      </Overlay>
    </Section>
  );
}

function JournalEntryCard({
  entry: e,
  editing,
  canEdit,
  busy,
  onDelete,
  onOpenPhoto,
}: {
  entry: JournalEntry;
  editing: boolean;
  canEdit: boolean;
  busy: boolean;
  onDelete: () => void;
  onOpenPhoto: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const clampable = !!e.body;
  return (
    <li className="rounded-xl border border-border bg-surface p-3" data-testid="journal-entry">
      <div className="flex items-start justify-between gap-3">
        <div
          className="min-w-0 flex-1"
          role={clampable ? "button" : undefined}
          tabIndex={clampable ? 0 : undefined}
          onClick={clampable ? () => setExpanded((x) => !x) : undefined}
          onKeyDown={
            clampable
              ? (ev) => {
                  if (ev.key !== "Enter" && ev.key !== " ") return;
                  ev.preventDefault();
                  setExpanded((x) => !x);
                }
              : undefined
          }
        >
          <div className="text-xs text-faint">{day(e.occurredAt)}</div>
          {e.title ? <div className="mt-0.5 text-sm font-semibold">{e.title}</div> : null}
          {e.body ? <p className={cx("mt-1 whitespace-pre-wrap text-sm leading-relaxed", !expanded && "line-clamp-3")}>{e.body}</p> : null}
          {e.kind === "photo" && e.width ? (
            <button
              type="button"
              onClick={(ev) => {
                ev.stopPropagation();
                // Safari does not focus a button on click, and the viewer hands
                // focus back to whatever had it when it opened.
                focusTrigger(ev);
                onOpenPhoto();
              }}
              className="mt-2 block h-24 w-24 overflow-hidden rounded-lg border border-border"
              aria-label={`Open ${e.title ?? "photo"} full screen`}
              data-testid="journal-photo-thumb"
            >
              <img src={`/api/journal/${e.id}/image`} alt={e.title ?? ""} loading="lazy" className="h-full w-full object-cover" />
            </button>
          ) : null}
          {e.kind === "photo" && !e.width ? <div className="mt-1 text-xs text-faint">photo not uploaded</div> : null}
        </div>
        {editing && canEdit ? (
          <button onClick={onDelete} disabled={busy} className="min-h-11 shrink-0 rounded-lg border border-bad/30 bg-bad/10 px-3 text-xs text-bad hover:bg-bad/20" aria-label={`Delete the entry from ${day(e.occurredAt)}`} data-testid="delete-entry">
            Delete
          </button>
        ) : null}
      </div>
    </li>
  );
}

function groupByRun(entries: JournalEntry[], sessions: PlaySession[]) {
  const groups: { key: string; heading: string | null; rows: JournalEntry[] }[] = [];
  const push = (key: string, heading: string | null, e: JournalEntry) => {
    const g = groups.find((x) => x.key === key);
    if (g) g.rows.push(e);
    else groups.push({ key, heading, rows: [e] });
  };
  for (const e of entries) {
    const s = e.sessionId ? sessions.find((x) => x.id === e.sessionId) : null;
    // An undated run's timestamps are the moment it was recorded, not dates —
    // heading its entries with them would contradict the play history two
    // sections up, which says "date unknown" for the same run.
    if (s) push(s.id, s.undated ? "Date unknown" : `${day(s.startedAt)} — ${s.endedAt ? day(s.endedAt) : "playing now"}`, e);
    else push("loose", "Not part of a run", e);
  }
  return groups;
}
