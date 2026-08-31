"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ManualWithPages } from "@/lib/manuals/service";
import { cx } from "@/components/ui";

/**
 * Page-by-page manual viewer, phone first.
 *
 * Deliberately not the map viewer: a manual page is read, not explored, so
 * there is no pan/zoom machinery here at all. The page is one `<img>` inside a
 * scroll container with `touch-action: pinch-zoom`, which hands zooming to the
 * browser — native, two-fingered, and free. `touch-action: pan-x pan-y` would
 * have taken it away.
 *
 * The full-screen shell is the journal photo overlay's, promoted to a route:
 * `fixed inset-0`, a title bar with a close/back, the page filling what is
 * left. Paging is prev/next buttons at 44px, arrow keys on a desktop, and a
 * horizontal swipe on a phone.
 */
export function ManualViewer({ gameId, gameName, manuals }: { gameId: string; gameName: string; manuals: ManualWithPages[] }) {
  const router = useRouter();
  const search = useSearchParams();
  const active = manuals.find((m) => m.id === search.get("m")) ?? manuals[0];
  // Scoped to the manual, so switching manuals resets to page one without an effect.
  const [at, setAt] = useState<{ manual: string; i: number } | null>(null);
  const i = at && at.manual === active?.id ? at.i : 0;
  const pages = active?.pages ?? [];
  const page = pages[Math.min(i, Math.max(0, pages.length - 1))] ?? null;
  const scrollRef = useRef<HTMLDivElement>(null);

  const go = useCallback(
    (delta: number) => {
      if (!active) return;
      setAt({ manual: active.id, i: Math.max(0, Math.min(pages.length - 1, i + delta)) });
      // A new page always starts at the top, however far into the last one you read.
      scrollRef.current?.scrollTo({ top: 0, left: 0 });
    },
    [active, i, pages.length],
  );

  // Arrow keys on a desktop; Escape goes back to the game.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight" || e.key === "PageDown") go(1);
      else if (e.key === "ArrowLeft" || e.key === "PageUp") go(-1);
      else if (e.key === "Escape") router.push(`/game/${gameId}`);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go, router, gameId]);

  // Horizontal swipe on a phone. Only when the gesture is decidedly sideways
  // and single-fingered — a pinch or a vertical drag on a zoomed-in page is
  // the browser's, and stealing it would make a zoomed page unreadable.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    let start: { x: number; y: number; id: number } | null = null;
    const down = (e: PointerEvent) => {
      if (e.pointerType === "mouse") return;
      start = { x: e.clientX, y: e.clientY, id: e.pointerId };
    };
    const up = (e: PointerEvent) => {
      if (!start || start.id !== e.pointerId) return;
      const dx = e.clientX - start.x;
      const dy = e.clientY - start.y;
      start = null;
      if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 2) go(dx < 0 ? 1 : -1);
    };
    // Every listener is a named function so the cleanup can remove the same
    // reference: this effect re-runs on each page turn (`go` changes identity),
    // and an inline arrow would leak one listener per page.
    const cancel = () => {
      start = null;
    };
    el.addEventListener("pointerdown", down);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", cancel);
    return () => {
      el.removeEventListener("pointerdown", down);
      el.removeEventListener("pointerup", up);
      el.removeEventListener("pointercancel", cancel);
    };
  }, [go]);

  if (!active) {
    return (
      <div className="flex h-dvh flex-col items-center justify-center gap-3 p-6 text-center">
        <p className="text-muted">No manual scanned for {gameName} yet.</p>
        <Link href={`/game/${gameId}`} className="text-sm text-accent hover:underline">
          ◂ Back to the game
        </Link>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 flex flex-col bg-bg text-text" data-testid="manual-viewer">
      <header className="flex items-center gap-2 border-b border-border px-3 py-2">
        <Link href={`/game/${gameId}`} className="flex h-11 min-w-11 shrink-0 items-center justify-center rounded-xl border border-border px-3 text-sm text-muted hover:border-muted hover:text-text" data-testid="manual-back">
          ◂<span className="ml-1.5 hidden max-w-40 truncate sm:inline">{gameName}</span>
        </Link>
        <div className="min-w-0 flex-1 text-center">
          <div className="truncate font-display text-sm font-bold">{active.title}</div>
          {page?.label ? <div className="truncate text-[11px] text-muted">{page.label}</div> : null}
        </div>
        {/* Balances the back button so the title stays centred. */}
        <div className="h-11 w-11 shrink-0" aria-hidden />
      </header>

      {manuals.length > 1 ? (
        <div className="flex gap-1.5 overflow-x-auto border-b border-border px-3 py-2 [scrollbar-width:none]" data-testid="manual-tabs">
          {manuals.map((m) => (
            <button
              key={m.id}
              onClick={() => router.replace(`/game/${gameId}/manual?m=${encodeURIComponent(m.id)}`, { scroll: false })}
              className={cx("min-h-8 shrink-0 rounded-full border px-3 text-xs", m.id === active.id ? "border-accent bg-accent text-accent-ink" : "border-border text-muted")}
              aria-current={m.id === active.id ? "page" : undefined}
            >
              {m.title}
            </button>
          ))}
        </div>
      ) : null}

      {/* `touch-action: pinch-zoom` leaves two-fingered zoom to the browser and
          keeps a one-fingered drag available for the swipe above. */}
      <div ref={scrollRef} className="flex min-h-0 flex-1 justify-center overflow-auto p-2 [touch-action:pinch-zoom]" data-testid="manual-page-area">
        {page ? (
          page.width ? (
            <img
              key={page.id}
              src={`/api/manual-pages/${page.id}/image`}
              alt={`${active.title} — page ${i + 1}`}
              width={page.width}
              height={page.height}
              className="h-auto max-h-full w-auto max-w-full self-center object-contain"
              data-testid="manual-page-image"
            />
          ) : (
            <p className="self-center text-sm text-faint" data-testid="manual-page-empty">
              Page {i + 1} has not been scanned yet.
            </p>
          )
        ) : (
          <p className="self-center text-sm text-faint">This manual has no pages yet.</p>
        )}
      </div>

      {/* Everything in the footer sits on the right: it is the thumb's half of
          a phone held one-handed, and the bottom-left corner belongs to the
          Next dev-tools overlay, which covers whatever is under it and swallows
          taps on it. */}
      <footer className="flex items-center justify-end gap-3 border-t border-border px-3 py-2 pb-safe">
        <span className="font-display text-sm text-muted" data-testid="manual-page-count">
          Page {pages.length ? i + 1 : 0} of {pages.length}
        </span>
        <div className="flex items-center gap-2">
          <button
            onClick={() => go(-1)}
            disabled={i === 0}
            className="flex h-11 min-w-11 items-center justify-center rounded-xl border border-border px-4 text-base text-text disabled:opacity-30"
            aria-label="Previous page"
            data-testid="manual-prev"
          >
            ◂
          </button>
          <button
            onClick={() => go(1)}
            disabled={i >= pages.length - 1}
            className="flex h-11 min-w-11 items-center justify-center rounded-xl border border-border px-4 text-base text-text disabled:opacity-30"
            aria-label="Next page"
            data-testid="manual-next"
          >
            ▸
          </button>
        </div>
      </footer>
    </div>
  );
}
