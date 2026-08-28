import Link from "next/link";

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-30 border-b border-border/70 bg-bg/80 backdrop-blur">
      <div className="mx-auto flex h-12 max-w-7xl items-center justify-between px-4">
        <Link href="/" className="font-display text-base font-bold tracking-tight">
          <span className="text-accent">▮</span> Game Explorer
        </Link>
        <nav className="flex items-center gap-1 text-sm">
          <Link href="/" className="rounded-lg px-3 py-1.5 text-muted hover:bg-surface-2 hover:text-text">
            Shelf
          </Link>
          <Link href="/import" className="rounded-lg px-3 py-1.5 text-muted hover:bg-surface-2 hover:text-text">
            Import
          </Link>
        </nav>
      </div>
    </header>
  );
}
