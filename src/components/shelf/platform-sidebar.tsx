"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";
import { cx } from "@/components/ui";
import type { Facets, Filters } from "@/lib/filters";
import { PlatformIcon } from "./platform-icon";

export function PlatformSidebar({ open, onClose, platforms, totalGames, filters, set }: { open: boolean; onClose: () => void; platforms: Facets["platforms"]; totalGames: number; filters: Filters; set: (patch: Partial<Filters>) => void }) {
  const closeButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKeyDown);
    closeButton.current?.focus();
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
      previouslyFocused?.focus();
    };
  }, [open, onClose]);

  if (!open) return null;
  const choose = (slug: string | null) => {
    set({ platforms: slug ? [slug] : [] });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-labelledby="platform-menu-title" data-testid="platform-sidebar">
      <button className="absolute inset-0 bg-black/70 backdrop-blur-[2px]" aria-label="Close platform menu" onClick={onClose} />
      <aside id="platform-menu" className="platform-drawer absolute inset-y-0 left-0 flex w-[min(22rem,88vw)] flex-col border-r border-border bg-bg-elev shadow-2xl">
        <div className="nes-stripe h-1 shrink-0" aria-hidden="true" />
        <div className="flex items-start justify-between border-b border-border px-5 py-5">
          <div>
            <p className="font-display text-xs font-bold uppercase tracking-[0.2em] text-accent">Select system</p>
            <h2 id="platform-menu-title" className="mt-1 font-display text-xl font-bold">Platform shelf</h2>
            <p className="mt-1 text-sm text-muted">Choose a console to see its games.</p>
          </div>
          <button ref={closeButton} type="button" onClick={onClose} className="flex h-11 w-11 items-center justify-center rounded-xl border border-border bg-surface text-xl text-muted hover:border-muted hover:text-text" aria-label="Close platform menu" data-testid="close-platforms">×</button>
        </div>

        {/* The drawer is the phone's main navigation, so "Now playing" lives at
            the top of it as well as in the header — one thumb, one tap, from
            the shelf. */}
        <div className="border-b border-border p-3">
          <Link href="/playing" onClick={onClose} className="flex min-h-14 w-full items-center gap-3 rounded-xl border border-accent/40 bg-accent/10 px-3 text-left text-text transition hover:border-accent" data-testid="sidebar-playing">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-white/10 bg-black/25 text-accent" aria-hidden="true">▶</span>
            <span className="min-w-0 flex-1 font-display font-semibold">Now playing</span>
            <span className="text-xs text-faint" aria-hidden="true">›</span>
          </Link>
        </div>

        <nav className="min-h-0 flex-1 overflow-y-auto p-3" aria-label="Game platforms">
          <button type="button" onClick={() => choose(null)} aria-pressed={filters.platforms.length === 0} className={cx("mb-2 flex min-h-14 w-full items-center gap-3 rounded-xl border px-3 text-left transition", filters.platforms.length === 0 ? "border-accent bg-accent/12 text-text" : "border-transparent text-muted hover:border-border hover:bg-surface hover:text-text")} data-testid="platform-all">
            <span className="grid h-9 w-9 shrink-0 grid-cols-2 gap-0.5 rounded-lg border border-white/10 bg-black/25 p-2 text-accent" aria-hidden="true"><span className="bg-current" /><span className="bg-current" /><span className="bg-current" /><span className="bg-current" /></span>
            <span className="min-w-0 flex-1 font-display font-semibold">All platforms</span>
            <span className="text-xs tabular-nums text-faint">{totalGames}</span>
          </button>
          <div className="mb-2 px-3 text-[0.65rem] font-bold uppercase tracking-[0.18em] text-faint">In your collection</div>
          <div className="grid gap-1">
            {platforms.map((platform) => {
              const selected = filters.platforms.length === 1 && filters.platforms[0] === platform.slug;
              return (
                <button key={platform.slug} type="button" onClick={() => choose(platform.slug)} aria-pressed={selected} className={cx("group flex min-h-14 w-full items-center gap-3 rounded-xl border px-3 text-left transition", selected ? "border-accent bg-accent/12 text-text" : "border-transparent text-muted hover:border-border hover:bg-surface hover:text-text")} data-testid={`platform-${platform.slug}`}>
                  <PlatformIcon platform={platform.slug} />
                  <span className="min-w-0 flex-1 truncate font-display font-semibold">{platform.label}</span>
                  <span className={cx("rounded-md px-2 py-1 text-xs tabular-nums", selected ? "bg-accent text-accent-ink" : "bg-surface-2 text-faint group-hover:text-muted")}>{platform.count}</span>
                </button>
              );
            })}
          </div>
        </nav>
      </aside>
    </div>
  );
}
