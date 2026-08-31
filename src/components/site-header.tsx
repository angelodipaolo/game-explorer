import Link from "next/link";
import { NavTrigger } from "@/components/nav-trigger";
import { platformCounts } from "@/lib/collection";
import { readViewer } from "@/lib/viewer";

/**
 * Reads the session itself rather than taking a prop: every page that renders
 * a header already renders it server-side, and threading `canEdit` through
 * eight call sites to hide one link is worse than one cookie read. The
 * platform counts behind the menu are read the same way and for the same
 * reason — one indexed query beats a prop drilled through nine pages.
 */
export async function SiteHeader() {
  const [viewer, menu] = await Promise.all([readViewer(), platformCounts()]);
  const { canEdit } = viewer;
  return (
    <header className="sticky top-0 z-30 border-b border-border/70 bg-bg/85 backdrop-blur">
      <div className="nes-stripe h-1" aria-hidden />
      <div className="mx-auto flex h-11 max-w-7xl items-center gap-2 px-4">
        {/* The menu comes first, at the left edge, because it is the main
            navigation now (GAMEEXPLOR-0018) and the thumb lives there. */}
        <NavTrigger platforms={menu.platforms} totalGames={menu.total} viewer={viewer} />
        <Link href="/" className="flex items-center gap-2 whitespace-nowrap font-display text-base font-bold tracking-tight">
          <span className="inline-block h-4 w-6 rounded-sm bg-accent" aria-hidden />
          <span>
            Game <span className="text-nes-grey">Explorer</span>
          </span>
        </Link>
        {/* Phone: the wordmark and the hamburger, nothing else. Four links plus
            a wordmark plus a 44px button do not fit in 390px — the wordmark
            wrapped to two lines and burst the row — and they no longer have to,
            because the drawer beside them is the whole menu now. From `sm` up
            there is room, so the same three or four pages stay one tap away
            without opening anything. */}
        <nav className="ml-auto hidden items-center gap-1 text-sm sm:flex">
          {/* The wordmark is home (GAMEEXPLOR-0012 moved it there); "Shelf" is
              the grid with the filters, now at /shelf. */}
          <Link href="/shelf" className="rounded-lg px-3 py-1.5 text-muted hover:bg-surface-2 hover:text-text" data-testid="nav-shelf">
            Shelf
          </Link>
          {/* Two homes on purpose: this is the one-tap route from anywhere with
              a header, and the menu carries it too because that is what a thumb
              reaches for. Short label, since this row is also the iPad's. */}
          <Link href="/playing" className="rounded-lg px-3 py-1.5 text-muted hover:bg-surface-2 hover:text-text" data-testid="nav-playing">
            Playing
          </Link>
          <Link href="/series" className="rounded-lg px-3 py-1.5 text-muted hover:bg-surface-2 hover:text-text" data-testid="nav-series">
            Series
          </Link>
          {/* Import is a curation tool: `src/proxy.ts` sends a visitor who
              types the URL to /login, so offering the link to one would only
              be a dead end. */}
          {canEdit ? (
            <Link href="/import" className="rounded-lg px-3 py-1.5 text-muted hover:bg-surface-2 hover:text-text" data-testid="nav-import">
              Import
            </Link>
          ) : null}
        </nav>
      </div>
    </header>
  );
}
