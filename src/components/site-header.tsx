import Link from "next/link";

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-30 border-b border-border/70 bg-bg/85 backdrop-blur">
      <div className="nes-stripe h-1" aria-hidden />
      <div className="mx-auto flex h-11 max-w-7xl items-center justify-between px-4">
        <Link href="/" className="flex items-center gap-2 font-display text-base font-bold tracking-tight">
          <span className="inline-block h-4 w-6 rounded-sm bg-accent" aria-hidden />
          <span>
            Game <span className="text-nes-grey">Explorer</span>
          </span>
        </Link>
        <nav className="flex items-center gap-1 text-sm">
          <Link href="/" className="rounded-lg px-3 py-1.5 text-muted hover:bg-surface-2 hover:text-text">
            Shelf
          </Link>
          {/* Two homes on purpose: this is the one-tap route from anywhere with
              a header, and the platform drawer carries it too because that is
              what a thumb reaches for on the shelf. Short label so the row still
              fits beside the wordmark at 390px. */}
          <Link href="/playing" className="rounded-lg px-3 py-1.5 text-muted hover:bg-surface-2 hover:text-text" data-testid="nav-playing">
            Playing
          </Link>
          <Link href="/import" className="rounded-lg px-3 py-1.5 text-muted hover:bg-surface-2 hover:text-text">
            Import
          </Link>
        </nav>
      </div>
    </header>
  );
}
