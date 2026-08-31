"use client";

import { useCallback, useState } from "react";
import { cx } from "@/components/ui";
import { SiteNav } from "@/components/site-nav";
import { useShelfFilters } from "@/components/shelf/filter-context";
import type { PlatformCount } from "@/lib/collection";
import type { Viewer } from "@/lib/viewer";

/**
 * The hamburger, and the only thing in `SiteHeader` that needs state. The
 * header is a server component (it reads the session and the platform counts),
 * so the open/close pair lives in this island rather than pushing the whole
 * header to the client.
 *
 * The button lights up while a platform filter is on, which is only knowable
 * on the shelf — off it `useShelfFilters` is null and it stays plain.
 */
export function NavTrigger({ platforms, totalGames, viewer }: { platforms: PlatformCount[]; totalGames: number; viewer: Viewer }) {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  const filtered = (useShelfFilters()?.platforms.length ?? 0) > 0;
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cx("-ml-2 flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border transition", filtered ? "border-accent bg-accent text-accent-ink" : "border-transparent text-text hover:border-border hover:bg-surface-2")}
        aria-label="Open main menu"
        aria-expanded={open}
        aria-controls="main-menu"
        data-testid="open-platforms"
      >
        <span className="grid w-5 gap-1" aria-hidden="true">
          <span className="h-0.5 bg-current" />
          <span className="h-0.5 bg-current" />
          <span className="h-0.5 bg-current" />
        </span>
      </button>
      <SiteNav open={open} onClose={close} platforms={platforms} totalGames={totalGames} viewer={viewer} />
    </>
  );
}
