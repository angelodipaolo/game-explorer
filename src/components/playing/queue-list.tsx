"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { QueuedRow } from "@/lib/collection";
import { Cover } from "@/components/shelf/cover";
import { apiError, cx } from "@/components/ui";

/**
 * "Up next", in order, with the controls you can work one-handed at 390px:
 * ▲ / ▼ to move a game, Play now to start it, × to drop it.
 *
 * Move buttons rather than drag-and-drop on purpose — touch dragging with
 * autoscroll is a library and a pile of edge cases for something you do while
 * holding a controller. Each tap sends the whole new order in one
 * `PATCH /api/queue`, which the service applies in a single transaction, so a
 * half-applied order is never readable.
 *
 * **`locked` is what keeps that contract true under a filter.** `PATCH
 * /api/queue` takes a full permutation of the queue and `reorderQueue` rejects
 * anything else, so the `orderedIds` built below is only valid while `rows` is
 * the entire queue. When `/playing` is filtered it is not, and "move up" has
 * no honest meaning anyway — up past what, the row the filter hid? So the two
 * arrows go away and a line says the order belongs to the whole queue. Play
 * now and remove are per row and stay live.
 */
export function QueueList({ rows, canEdit, locked = false, dim, onClearFilters }: { rows: QueuedRow[]; canEdit: boolean; /** A filter is on: the rows are a subset, so reordering is off. */ locked?: boolean; /** Owned-copy ids that are "could work" — no data either way — and render dimmed. A set rather than a boundary index, because the queue keeps its curated order under a filter and the dimmed ones stay where they are. */ dim?: Set<string>; onClearFilters?: () => void }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function call(method: "POST" | "PATCH" | "DELETE", url: string, body?: object) {
    setBusy(true);
    try {
      const res = await fetch(url, { method, headers: { "content-type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) });
      if (!res.ok) throw await apiError(res);
      router.refresh();
    } catch (e) {
      alert((e as Error).message);
      // The reorder this list sends must be exactly what is queued now, so a
      // queue changed elsewhere (or on another phone) 400s here. The stale
      // order is still on screen at that point, and re-sending it would fail
      // the same way — refresh so the next tap works from the real queue.
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  const move = (i: number, delta: number) => {
    // Belt and braces with `locked`: a partial permutation must never leave
    // this component, whatever a stray render or a rogue click does.
    if (locked) return;
    const order = rows.map((r) => r.ownedGameId);
    const j = i + delta;
    if (j < 0 || j >= order.length) return;
    [order[i], order[j]] = [order[j], order[i]];
    void call("PATCH", "/api/queue", { orderedIds: order });
  };

  // Each row wraps at 390px: four controls and a game title cannot share one
  // line there without truncating the title to "1-2-…", so the name gets its
  // own line and the controls sit under it. One row again from `sm` up.
  return (
    <>
      <ul className="flex flex-col gap-2" data-testid="queue-list">
        {rows.map((r, i) => (
          <li key={r.ownedGameId} className={cx("flex flex-wrap items-center gap-2 rounded-xl border border-border bg-surface p-2", dim?.has(r.ownedGameId) && "opacity-60")} data-testid="queue-row">
            <Link href={`/game/${r.ownedGameId}`} className="flex min-w-0 basis-full items-center gap-3 sm:basis-0 sm:flex-1" prefetch={false}>
              <Cover imageId={r.cover} title={r.name} size="small" className="w-10 shrink-0 rounded-md" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{r.name}</span>
                <span className="block truncate text-xs text-muted">
                  {r.platformLabel}
                  {r.note ? ` · ${r.note}` : ""}
                </span>
              </span>
            </Link>
            {/* Read-only for a visitor: the order is the interesting part, the
                four controls that change it are the owner's. */}
            {canEdit ? (
              <div className="ml-auto flex shrink-0 items-center gap-1">
                <button onClick={() => move(i, -1)} disabled={busy || locked || i === 0} className="h-11 w-11 rounded-lg border border-border text-sm text-muted hover:border-muted hover:text-text disabled:opacity-30" aria-label={`Move ${r.name} up`} data-testid="queue-up">
                  ▲
                </button>
                <button onClick={() => move(i, 1)} disabled={busy || locked || i === rows.length - 1} className="h-11 w-11 rounded-lg border border-border text-sm text-muted hover:border-muted hover:text-text disabled:opacity-30" aria-label={`Move ${r.name} down`} data-testid="queue-down">
                  ▼
                </button>
                {/* Starting a run dequeues the copy in the same transaction, so this
                    row lands in "In progress" on the very next refresh. */}
                <button onClick={() => call("POST", `/api/games/${r.ownedGameId}/sessions`, {})} disabled={busy} className="min-h-11 rounded-lg bg-accent px-3 text-sm font-semibold text-accent-ink disabled:opacity-40" aria-label={`Play ${r.name} now`} data-testid="queue-play-now">
                  Play now
                </button>
                <button onClick={() => call("DELETE", `/api/queue/${r.ownedGameId}`)} disabled={busy} className="h-11 w-11 rounded-lg border border-border text-lg text-muted hover:border-muted hover:text-text disabled:opacity-40" aria-label={`Remove ${r.name} from the queue`} data-testid="queue-remove-row">
                  ×
                </button>
              </div>
            ) : null}
          </li>
        ))}
      </ul>
      {canEdit && locked ? (
        <p className="mt-2 text-xs text-muted" data-testid="queue-reorder-locked">
          The order is the whole queue&rsquo;s, so moving a game needs every game on screen.{" "}
          {onClearFilters ? (
            <button onClick={onClearFilters} className="text-accent-2 underline">
              Clear the filters
            </button>
          ) : (
            "Clear the filters"
          )}{" "}
          to reorder.
        </p>
      ) : null}
    </>
  );
}
