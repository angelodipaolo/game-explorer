"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { PlaySession } from "@prisma/client";
import { apiError, cx, day, dateInput } from "@/components/ui";
import { Section, openSection } from "@/components/game/section";

/**
 * Past runs for one owned copy: the log this game's play state is derived
 * from. There is no status column anywhere behind this — an open run is a row
 * with no `endedAt`, and that is the only definition of "playing now".
 *
 * The open-run banner and the start/queue buttons live in `play-controls.tsx`
 * now, in the header block above the fold — this component keeps the
 * past-runs list, its edit toggle, and the add-a-past-run form. Both stay
 * client components hitting the same endpoints and calling `router.refresh()`;
 * there is no shared state to thread, the server refresh reconciles them.
 *
 * The inline-editor pattern from TagEditor: read-only until you toggle Edit,
 * every write goes through the API and ends in `router.refresh()`, and every
 * control is a 44px tap target because the whole point is tapping "Finished"
 * on the couch with a controller in the other hand.
 */

const OUTCOME_LABEL: Record<string, string> = { playing: "Playing", completed: "Finished it", abandoned: "Gave up" };

export function PlayHistory({ gameId, sessions, canEdit }: { gameId: string; sessions: PlaySession[]; canEdit: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [pastOpen, setPastOpen] = useState(false);

  const closed = sessions.filter((s) => s.endedAt);

  async function call(method: "POST" | "PATCH" | "DELETE", url: string, body?: object) {
    setBusy(true);
    try {
      const res = await fetch(url, { method, headers: { "content-type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) });
      if (!res.ok) throw await apiError(res);
      setEditId(null);
      setPastOpen(false);
      router.refresh();
      return true;
    } catch (e) {
      alert((e as Error).message);
      router.refresh();
      return false;
    } finally {
      setBusy(false);
    }
  }

  const editButton =
    closed.length && canEdit ? (
      <button onClick={() => setEditing((e) => !e)} className="tap-44 min-h-8 rounded-full border border-border px-3 text-xs text-muted hover:border-muted hover:text-text" data-testid="edit-runs">
        {editing ? "Done" : "Edit"}
      </button>
    ) : null;

  // Nothing to read here yet — the CTA lives above the fold now — so this
  // stays a quiet closed row, "+ a run that already happened" in the header
  // instead of an open drawer of onboarding copy (GAMEEXPLOR-0023 round 2,
  // item E).
  const emptyAddButton =
    !closed.length && canEdit ? (
      <button
        onClick={() => {
          openSection("play");
          setPastOpen(true);
        }}
        className="tap-44 min-h-8 rounded-full border border-border px-3 text-xs text-muted hover:border-muted hover:text-text"
        data-testid="add-past-run-empty"
      >
        + a run that already happened
      </button>
    ) : null;

  return (
    <Section
      id="play"
      title="Play history"
      count={sessions.length}
      testId="play-history"
      collapsible
      defaultOpen={closed.length > 0}
      storageKey="play"
      action={editButton}
      emptyAction={emptyAddButton}
      className="max-w-3xl"
    >
      {closed.length ? (
        <ul className="flex flex-col gap-2">
          {closed.map((s) =>
            editId === s.id ? (
              <li key={s.id}>
                <RunForm
                  initial={s}
                  busy={busy}
                  onCancel={() => setEditId(null)}
                  onSubmit={(body) => call("PATCH", `/api/sessions/${s.id}`, body)}
                  // "Still playing it" needs a start to resume from, and an
                  // undated run's is the day it was typed in. The service
                  // refuses it too; this keeps the button off the screen.
                  onReopen={s.undated ? undefined : () => call("PATCH", `/api/sessions/${s.id}`, { endedAt: null })}
                  onDelete={() => confirm("Delete this run? Anything written during it stays in the journal.") && call("DELETE", `/api/sessions/${s.id}`)}
                />
              </li>
            ) : (
              <li key={s.id} className="flex items-start justify-between gap-3 rounded-xl border border-border bg-surface p-3" data-testid="run-row">
                <div className="min-w-0">
                  <div className="text-sm font-medium">
                    {/* An undated run's timestamps are the day it was typed in, so
                        they are never shown — "at some point" is the whole claim. */}
                    {s.undated ? (
                      <span className="text-muted" data-testid="run-undated">
                        Played · date unknown
                      </span>
                    ) : (
                      <>
                        {day(s.startedAt)} — {day(s.endedAt!)}
                      </>
                    )}
                    <span className={cx("ml-2 text-xs", s.outcome === "completed" ? "text-good" : "text-muted")}>{OUTCOME_LABEL[s.outcome] ?? s.outcome}</span>
                  </div>
                  {s.note ? <p className="mt-1 whitespace-pre-wrap text-sm text-muted">{s.note}</p> : null}
                </div>
                {editing && canEdit ? (
                  <button onClick={() => setEditId(s.id)} disabled={busy} className="min-h-11 shrink-0 rounded-lg border border-border px-3 text-xs text-muted hover:border-muted hover:text-text" aria-label={s.undated ? "Edit the run with no dates" : `Edit the run from ${day(s.startedAt)}`}>
                    Edit
                  </button>
                ) : null}
              </li>
            ),
          )}
        </ul>
      ) : null}

      {canEdit ? (
        <div className="mt-3">
          {pastOpen ? (
            <RunForm past busy={busy} onCancel={() => setPastOpen(false)} onSubmit={(body) => call("POST", `/api/games/${gameId}/sessions`, body)} />
          ) : (
            <button onClick={() => setPastOpen(true)} className="min-h-11 rounded-xl border border-dashed border-border px-4 text-sm text-muted hover:border-muted hover:text-text" data-testid="add-past-run">
              + a run that already happened
            </button>
          )}
        </div>
      ) : null}
      {!sessions.length && !pastOpen ? <p className="mt-2 text-xs text-faint">Runs at this copy. Finishing one keeps its dates and its journal, so a replay in three years is its own run.</p> : null}
    </Section>
  );
}

type RunBody = { startedAt: string; endedAt: string; undated: false; outcome: string; note: string | null } | { undated: true; outcome: string; note: string | null };

/**
 * One run's dates, outcome and note. Date-only inputs on purpose: the API
 * reads a bare `YYYY-MM-DD` as local midnight, so a run backdated to
 * "yesterday" on a phone never renders as the day before that.
 *
 * A run you know you played but cannot date is the common case for anything
 * you owned as a child, so the dates come off entirely rather than being
 * guessed: ticking the box drops the two inputs out of the form and sends
 * `undated: true` with no dates at all. Unticking it on a saved run is the
 * other half — the way you fill the dates in once you remember them.
 */
function RunForm({ initial, past, busy, onCancel, onSubmit, onReopen, onDelete }: { initial?: PlaySession; past?: boolean; busy: boolean; onCancel: () => void; onSubmit: (body: RunBody) => Promise<boolean>; onReopen?: () => void; onDelete?: () => void }) {
  // An undated run's stored timestamps are the afternoon it was typed in, so
  // seeding the inputs from them would hand that back as the answer and let one
  // tap on Save enshrine it — exactly the corruption the flag exists to prevent.
  // Empty instead; the inputs are `required`, so the form asks for real dates
  // before it will submit. A brand new past run still defaults to today.
  const [startedAt, setStartedAt] = useState(initial ? (initial.undated ? "" : dateInput(initial.startedAt)) : dateInput(new Date()));
  const [endedAt, setEndedAt] = useState(initial ? (initial.undated ? "" : dateInput(initial.endedAt ?? new Date())) : dateInput(new Date()));
  const [undated, setUndated] = useState(initial?.undated ?? false);
  const [outcome, setOutcome] = useState(initial && initial.outcome !== "playing" ? initial.outcome : "completed");
  const [note, setNote] = useState(initial?.note ?? "");
  const field = "min-h-11 w-full rounded-lg border border-border bg-bg px-3 text-base outline-none focus:border-accent";
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void onSubmit(undated ? { undated: true, outcome, note: note.trim() || null } : { startedAt, endedAt, undated: false, outcome, note: note.trim() || null });
      }}
      className="rounded-xl border border-border bg-bg-elev p-3"
      data-testid="run-form"
    >
      <div className="grid gap-2 sm:grid-cols-3">
        <label className="flex min-h-11 items-center gap-2 text-sm text-muted sm:col-span-3">
          <input
            type="checkbox"
            checked={undated}
            // Ticking this on a run that has real dates overwrites them with
            // placeholders and there is no undo, so it asks first — the same
            // stance as Delete right beside it.
            onChange={(e) => {
              if (e.target.checked && initial && !initial.undated && !confirm("Forget this run's dates? They cannot be recovered.")) return;
              setUndated(e.target.checked);
            }}
            className="h-5 w-5 accent-accent"
            data-testid="run-undated-toggle"
          />
          I don’t know the dates
        </label>
        {/* Not merely disabled: an unsubmitted `required` date input that is
            hidden blocks the form silently, and the dates are not part of this
            run at all when the box is ticked. */}
        {undated ? null : (
          <>
            <label className="text-xs text-muted">
              Started
              <input type="date" value={startedAt} onChange={(e) => setStartedAt(e.target.value)} required className={cx(field, "mt-1")} aria-label="Started" data-testid="run-started" />
            </label>
            <label className="text-xs text-muted">
              Finished
              <input type="date" value={endedAt} onChange={(e) => setEndedAt(e.target.value)} required className={cx(field, "mt-1")} aria-label="Finished" data-testid="run-ended" />
            </label>
          </>
        )}
        <label className="text-xs text-muted">
          How it went
          <select value={outcome} onChange={(e) => setOutcome(e.target.value)} className={cx(field, "mt-1")} aria-label="How it went">
            <option value="completed">Finished it</option>
            <option value="abandoned">Gave up</option>
          </select>
        </label>
        <label className="text-xs text-muted sm:col-span-3">
          Note
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Second playthrough, hard mode" className={cx(field, "mt-1")} aria-label="Run note" data-testid="run-note" />
        </label>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button type="submit" disabled={busy} className="min-h-11 rounded-lg bg-accent px-4 text-sm font-semibold text-accent-ink disabled:opacity-40" data-testid="save-run">
          {past ? "Add run" : "Save"}
        </button>
        <button type="button" onClick={onCancel} disabled={busy} className="min-h-11 rounded-lg border border-border px-4 text-sm text-muted hover:border-muted hover:text-text">
          Cancel
        </button>
        {onReopen ? (
          <button type="button" onClick={onReopen} disabled={busy} className="min-h-11 rounded-lg border border-border px-4 text-sm text-muted hover:border-muted hover:text-text" data-testid="reopen-run">
            Still playing it
          </button>
        ) : null}
        {onDelete ? (
          <button type="button" onClick={onDelete} disabled={busy} className="ml-auto min-h-11 rounded-lg border border-bad/30 bg-bad/10 px-4 text-sm text-bad hover:bg-bad/20" data-testid="delete-run">
            Delete
          </button>
        ) : null}
      </div>
    </form>
  );
}
