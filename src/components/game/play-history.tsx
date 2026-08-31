"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { PlaySession } from "@prisma/client";
import { apiError, cx, day, dateInput } from "@/components/ui";

/**
 * Play history for one owned copy: the log this game's play state is derived
 * from. There is no status column anywhere behind this — an open run is a row
 * with no `endedAt`, and that is the only definition of "playing now".
 *
 * The inline-editor pattern from TagEditor: read-only until you toggle Edit,
 * every write goes through the API and ends in `router.refresh()`, and every
 * control is a 44px tap target because the whole point is tapping "Finished"
 * on the couch with a controller in the other hand.
 */

const OUTCOME_LABEL: Record<string, string> = { playing: "Playing", completed: "Finished it", abandoned: "Gave up" };

export function PlayHistory({ gameId, sessions, queued }: { gameId: string; sessions: PlaySession[]; queued: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [pastOpen, setPastOpen] = useState(false);

  const open = sessions.find((s) => !s.endedAt) ?? null;
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
      // A rejected write usually means this page is out of date — a double-tap
      // on "Start playing" is a 409 because the first tap already opened the
      // run, and the second tab that finished it makes "Finished" a 404. Pull
      // the truth back down rather than leaving the stale buttons on screen.
      router.refresh();
      return false;
    } finally {
      setBusy(false);
    }
  }

  const start = () => call("POST", `/api/games/${gameId}/sessions`, {});
  // `endedAt` has to be sent: leaving it out means "no change", which for an
  // open run would keep it open (and the service would force it back to "playing").
  const finish = (outcome: "completed" | "abandoned") => open && call("PATCH", `/api/sessions/${open.id}`, { outcome, endedAt: new Date().toISOString() });

  return (
    <section className="mt-8 max-w-3xl" data-testid="play-history">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="font-display text-base font-bold">
          Play history {sessions.length ? <span className="text-muted">· {sessions.length} {sessions.length === 1 ? "run" : "runs"}</span> : null}
        </h2>
        {closed.length ? (
          <button onClick={() => setEditing((e) => !e)} className="min-h-8 rounded-full border border-border px-3 text-xs text-muted hover:border-muted hover:text-text" data-testid="edit-runs">
            {editing ? "Done" : "Edit"}
          </button>
        ) : null}
      </div>

      {open ? (
        <div className="rounded-xl border border-accent/50 bg-accent/10 p-3" data-testid="open-run">
          <div className="font-display text-sm font-bold">
            <span className="text-accent" aria-hidden>▶</span> Playing since {day(open.startedAt)}
          </div>
          {open.note ? <p className="mt-1 text-sm text-muted">{open.note}</p> : null}
          <div className="mt-3 flex flex-wrap gap-2">
            <button onClick={() => finish("completed")} disabled={busy} className="min-h-11 rounded-xl bg-accent px-4 text-sm font-semibold text-accent-ink disabled:opacity-40" data-testid="finish-run">
              Finished
            </button>
            <button onClick={() => finish("abandoned")} disabled={busy} className="min-h-11 rounded-xl border border-border bg-surface px-4 text-sm hover:border-muted disabled:opacity-40" data-testid="give-up-run">
              Gave up
            </button>
            {/* The mis-tap escape: the run never happened, so it is deleted rather than closed. */}
            <button
              onClick={() => confirm("Undo starting this run? It is removed from the log.") && call("DELETE", `/api/sessions/${open.id}`)}
              disabled={busy}
              className="ml-auto min-h-11 rounded-xl px-3 text-sm text-muted hover:text-text disabled:opacity-40"
              data-testid="undo-run"
            >
              Undo
            </button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <button onClick={start} disabled={busy} className="min-h-11 rounded-xl bg-accent px-4 text-sm font-semibold text-accent-ink disabled:opacity-40" data-testid={closed.length ? "play-again" : "start-run"}>
            {closed.length ? "Play again" : "Start playing"}
          </button>
          {/* A copy cannot be both up next and in progress, so this pair only exists while no run is open. */}
          {queued ? (
            <button onClick={() => call("DELETE", `/api/queue/${gameId}`)} disabled={busy} className="min-h-11 rounded-xl border border-accent-2/40 bg-accent-2/10 px-4 text-sm text-accent-2 disabled:opacity-40" data-testid="queue-remove">
              ✓ Up next — remove
            </button>
          ) : (
            <button onClick={() => call("POST", "/api/queue", { ownedGameId: gameId })} disabled={busy} className="min-h-11 rounded-xl border border-border bg-surface px-4 text-sm hover:border-muted disabled:opacity-40" data-testid="queue-add">
              Add to queue
            </button>
          )}
        </div>
      )}

      {closed.length ? (
        <ul className="mt-3 flex flex-col gap-2">
          {closed.map((s) =>
            editId === s.id ? (
              <li key={s.id}>
                <RunForm
                  initial={s}
                  busy={busy}
                  onCancel={() => setEditId(null)}
                  onSubmit={(body) => call("PATCH", `/api/sessions/${s.id}`, body)}
                  onReopen={() => call("PATCH", `/api/sessions/${s.id}`, { endedAt: null })}
                  onDelete={() => confirm("Delete this run? Anything written during it stays in the journal.") && call("DELETE", `/api/sessions/${s.id}`)}
                />
              </li>
            ) : (
              <li key={s.id} className="flex items-start justify-between gap-3 rounded-xl border border-border bg-surface p-3" data-testid="run-row">
                <div className="min-w-0">
                  <div className="text-sm font-medium">
                    {day(s.startedAt)} — {day(s.endedAt!)}
                    <span className={cx("ml-2 text-xs", s.outcome === "completed" ? "text-good" : "text-muted")}>{OUTCOME_LABEL[s.outcome] ?? s.outcome}</span>
                  </div>
                  {s.note ? <p className="mt-1 whitespace-pre-wrap text-sm text-muted">{s.note}</p> : null}
                </div>
                {editing ? (
                  <button onClick={() => setEditId(s.id)} disabled={busy} className="min-h-11 shrink-0 rounded-lg border border-border px-3 text-xs text-muted hover:border-muted hover:text-text" aria-label={`Edit the run from ${day(s.startedAt)}`}>
                    Edit
                  </button>
                ) : null}
              </li>
            ),
          )}
        </ul>
      ) : null}

      <div className="mt-3">
        {pastOpen ? (
          <RunForm past busy={busy} onCancel={() => setPastOpen(false)} onSubmit={(body) => call("POST", `/api/games/${gameId}/sessions`, body)} />
        ) : (
          <button onClick={() => setPastOpen(true)} className="min-h-11 rounded-xl border border-dashed border-border px-4 text-sm text-muted hover:border-muted hover:text-text" data-testid="add-past-run">
            + a run that already happened
          </button>
        )}
      </div>
      {!sessions.length && !pastOpen ? <p className="mt-2 text-xs text-faint">Runs at this copy. Finishing one keeps its dates and its journal, so a replay in three years is its own run.</p> : null}
    </section>
  );
}

type RunBody = { startedAt: string; endedAt: string; outcome: string; note: string | null };

/**
 * One run's dates, outcome and note. Date-only inputs on purpose: the API
 * reads a bare `YYYY-MM-DD` as local midnight, so a run backdated to
 * "yesterday" on a phone never renders as the day before that.
 */
function RunForm({ initial, past, busy, onCancel, onSubmit, onReopen, onDelete }: { initial?: PlaySession; past?: boolean; busy: boolean; onCancel: () => void; onSubmit: (body: RunBody) => Promise<boolean>; onReopen?: () => void; onDelete?: () => void }) {
  const [startedAt, setStartedAt] = useState(dateInput(initial?.startedAt ?? new Date()));
  const [endedAt, setEndedAt] = useState(dateInput(initial?.endedAt ?? new Date()));
  const [outcome, setOutcome] = useState(initial && initial.outcome !== "playing" ? initial.outcome : "completed");
  const [note, setNote] = useState(initial?.note ?? "");
  const field = "min-h-11 w-full rounded-lg border border-border bg-bg px-3 text-base outline-none focus:border-accent";
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void onSubmit({ startedAt, endedAt, outcome, note: note.trim() || null });
      }}
      className="rounded-xl border border-border bg-bg-elev p-3"
      data-testid="run-form"
    >
      <div className="grid gap-2 sm:grid-cols-3">
        <label className="text-xs text-muted">
          Started
          <input type="date" value={startedAt} onChange={(e) => setStartedAt(e.target.value)} required className={cx(field, "mt-1")} aria-label="Started" data-testid="run-started" />
        </label>
        <label className="text-xs text-muted">
          Finished
          <input type="date" value={endedAt} onChange={(e) => setEndedAt(e.target.value)} required className={cx(field, "mt-1")} aria-label="Finished" data-testid="run-ended" />
        </label>
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
