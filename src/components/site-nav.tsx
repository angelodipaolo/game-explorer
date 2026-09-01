"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { cx } from "@/components/ui";
import type { PlatformCount } from "@/lib/collection";
import type { Viewer } from "@/lib/viewer";
import { AuthMenu } from "@/components/auth-menu";
import { useShelfFilters } from "@/components/shelf/filter-context";
import { PlatformIcon } from "@/components/shelf/platform-icon";

/**
 * The places worth going, above the consoles.
 *
 * Import is owner-only and last: `src/proxy.ts` sends a visitor who types the
 * URL to /login, so offering them the link would only be a dead end. It has to
 * be here rather than only in the header row, because that row is `hidden
 * sm:flex` — on a phone this drawer is the ONLY way to reach /import.
 */
const PAGES = [
  { href: "/shelf", label: "Shelf", icon: "▦", testId: "sidebar-shelf", accent: false, ownerOnly: false },
  { href: "/playing", label: "Now playing", icon: "▶", testId: "sidebar-playing", accent: true, ownerOnly: false },
  { href: "/series", label: "Series", icon: "▤", testId: "sidebar-series", accent: false, ownerOnly: false },
  { href: "/settings", label: "Settings", icon: "⚙", testId: "sidebar-settings", accent: false, ownerOnly: false },
  { href: "/import", label: "Import", icon: "⇪", testId: "sidebar-import", accent: false, ownerOnly: true },
];

/**
 * The main menu (GAMEEXPLOR-0018). It began as the shelf's platform drawer and
 * is now on every page, opened by the hamburger in `SiteHeader` — which is why
 * it carries the page links as well as the consoles: on a phone this is the
 * navigation, and the header row has space for a wordmark and little else.
 *
 * The platform rows are links into `/shelf?platform=…` so they work from a
 * game page or `/series`. On the shelf itself `useShelfFilters` hands back the
 * shelf's own setter and they become buttons that filter in place, because
 * navigating there would re-render the server page and re-send the whole
 * collection (see `use-filters.ts`).
 */
export function SiteNav({ open, onClose, platforms, totalGames, viewer }: { open: boolean; onClose: () => void; platforms: PlatformCount[]; totalGames: number; viewer: Viewer }) {
  const closeButton = useRef<HTMLButtonElement>(null);
  const pathname = usePathname();
  const router = useRouter();
  const shelf = useShelfFilters();

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
  const selected = (slug: string | null) => {
    if (!shelf) return false;
    return slug ? shelf.platforms.length === 1 && shelf.platforms[0] === slug : shelf.platforms.length === 0;
  };
  // The route decides, NOT whether the shelf has registered yet. React 19
  // hydrates selectively and this drawer's trigger is in the header, a sibling
  // of the shelf's own Suspense boundary — so there is a window on /shelf where
  // the header is live and `useShelfFilters()` is still null. Choosing on that
  // would quietly render links in that window and turn one tap into the full
  // server round trip the whole seam exists to avoid. `router.replace` is the
  // fallback for those few milliseconds: costly, but correct and rare, and it
  // never reaches a dead button.
  const onShelf = pathname === "/shelf";
  const choose = onShelf
    ? (slug: string | null) => {
        if (shelf) shelf.set({ platforms: slug ? [slug] : [] });
        else router.replace(slug ? `/shelf?platform=${slug}` : "/shelf", { scroll: false });
        onClose();
      }
    : null;

  // Portalled to the body on purpose. The trigger lives in `SiteHeader`, and
  // the header's `backdrop-blur` makes it a containing block for `fixed`
  // descendants — rendered in place the drawer would be 44px tall and its
  // contents would spill across the page. The portal keeps the React tree (and
  // therefore the shelf's filter context) exactly as it is.
  return createPortal(
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label="Main menu" data-testid="platform-sidebar">
      <button className="absolute inset-0 bg-black/70 backdrop-blur-[2px]" aria-label="Close menu" onClick={onClose} />
      <aside id="main-menu" className="platform-drawer absolute inset-y-0 left-0 flex w-[min(22rem,88vw)] flex-col border-r border-border bg-bg-elev shadow-2xl">
        <div className="nes-stripe h-1 shrink-0" aria-hidden="true" />
        <div className="flex items-center justify-end border-b border-border px-5 py-3">
          <button ref={closeButton} type="button" onClick={onClose} className="flex h-11 w-11 items-center justify-center rounded-xl border border-border bg-surface text-xl text-muted hover:border-muted hover:text-text" aria-label="Close menu" data-testid="close-platforms">×</button>
        </div>

        {/* The whole app, above the consoles: this is the main menu now, not a
            shortcut off the shelf, so it has to reach every page from any page. */}
        <nav className="grid gap-2 border-b border-border p-3" aria-label="Pages">
          {PAGES.filter((page) => !page.ownerOnly || viewer.canEdit).map((page) => (
            <Link
              key={page.href}
              href={page.href}
              onClick={onClose}
              aria-current={pathname === page.href ? "page" : undefined}
              className={cx("flex min-h-14 w-full items-center gap-3 rounded-xl border px-3 text-left text-text transition", page.accent ? "border-accent/40 bg-accent/10 hover:border-accent" : "border-border bg-surface hover:border-muted")}
              data-testid={page.testId}
            >
              <span className={cx("grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-white/10 bg-black/25", page.accent ? "text-accent" : "text-accent-2")} aria-hidden="true">{page.icon}</span>
              <span className="min-w-0 flex-1 font-display font-semibold">{page.label}</span>
              <span className="text-xs text-faint" aria-hidden="true">›</span>
            </Link>
          ))}
        </nav>

        <nav className="min-h-0 flex-1 overflow-y-auto p-3" aria-label="Game platforms">
          <PlatformRow href="/shelf" onSelect={choose ? () => choose(null) : null} onClose={onClose} selected={selected(null)} testId="platform-all" className="mb-2" count={totalGames} label="All platforms">
            <span className="grid h-9 w-9 shrink-0 grid-cols-2 gap-0.5 rounded-lg border border-white/10 bg-black/25 p-2 text-accent" aria-hidden="true"><span className="bg-current" /><span className="bg-current" /><span className="bg-current" /><span className="bg-current" /></span>
          </PlatformRow>
          <div className="mb-2 px-3 text-[0.65rem] font-bold uppercase tracking-[0.18em] text-faint">In your collection</div>
          <div className="grid gap-1">
            {platforms.map((platform) => (
              <PlatformRow
                key={platform.slug}
                href={`/shelf?platform=${platform.slug}`}
                onSelect={choose ? () => choose(platform.slug) : null}
                onClose={onClose}
                selected={selected(platform.slug)}
                testId={`platform-${platform.slug}`}
                count={platform.count}
                label={platform.label}
                chip
              >
                <PlatformIcon platform={platform.slug} />
              </PlatformRow>
            ))}
          </div>
        </nav>
        <AuthMenu viewer={viewer} className="shrink-0 border-t border-border px-5 py-3 pb-safe" />
      </aside>
    </div>,
    document.body,
  );
}

/**
 * One console. A `<button>` when the shelf is mounted and handed us its
 * setter, otherwise the same row as a link into the shelf — same look, same
 * `data-testid`, so a phone cannot tell which page it is standing on.
 */
function PlatformRow({ href, onSelect, onClose, selected, testId, className, label, count, chip, children }: { href: string; onSelect: (() => void) | null; onClose: () => void; selected: boolean; testId: string; className?: string; label: string; count: number; chip?: boolean; children: ReactNode }) {
  const cls = cx("group flex min-h-14 w-full items-center gap-3 rounded-xl border px-3 text-left transition", selected ? "border-accent bg-accent/12 text-text" : "border-transparent text-muted hover:border-border hover:bg-surface hover:text-text", className);
  const body = (
    <>
      {children}
      <span className="min-w-0 flex-1 truncate font-display font-semibold">{label}</span>
      {chip ? (
        <span className={cx("rounded-md px-2 py-1 text-xs tabular-nums", selected ? "bg-accent text-accent-ink" : "bg-surface-2 text-faint group-hover:text-muted")}>{count}</span>
      ) : (
        <span className="text-xs tabular-nums text-faint">{count}</span>
      )}
    </>
  );
  if (onSelect) {
    return (
      <button type="button" onClick={onSelect} aria-pressed={selected} className={cls} data-testid={testId}>
        {body}
      </button>
    );
  }
  return (
    <Link href={href} onClick={onClose} className={cls} data-testid={testId}>
      {body}
    </Link>
  );
}
