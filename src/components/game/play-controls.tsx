"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { PlaySession } from "@prisma/client";
import { apiError, day } from "@/components/ui";

/**
 * The primary action, moved above the fold: the open-run banner and the
 * start/queue buttons used to sit ~2,000px down inside Play History. This is
 * the button the app exists for, so it renders directly under the play line
 * — `play-history.tsx` keeps only the past-runs list beneath it.
 *
 * Read-only for a visitor (`canEdit` false): no buttons render, but an open
 * run still shows as a static "Playing now" chip. A visitor should be able to
 * see that a game is being played even though they cannot start or stop one.
 */
export function PlayControls({ gameId, sessions, queued, canEdit }: { gameId: string; sessions: PlaySession[]; queued: boolean; canEdit: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  const open = sessions.find((s) => !s.endedAt) ?? null;
  const closed = sessions.filter((s) => s.endedAt);

  async function call(method: "POST" | "PATCH" | "DELETE", url: string, body?: object) {
    setBusy(true);
    try {
      const res = await fetch(url, { method, headers: { "content-type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) });
      if (!res.ok) throw await apiError(res);
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

  if (!canEdit) {
    if (!open) return queued ? (
      <p className="mt-3 text-sm text-accent-2" data-testid="queued-note">
        Up next.
      </p>
    ) : null;
    // A visitor still sees that this copy is being played — that is a fact
    // about the collection, not a control.
    return (
      <div className="mt-3 inline-flex min-h-9 items-center gap-1.5 rounded-full bg-accent/15 px-3 text-sm text-accent" data-testid="open-run">
        <span aria-hidden>▶</span> Playing since {day(open.startedAt)}
      </div>
    );
  }

  return (
    <div className="mt-3">
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
    </div>
  );
}
