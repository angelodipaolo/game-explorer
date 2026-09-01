"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { cx } from "@/components/ui";

/**
 * Collection search (GAMEEXPLOR-0027). One control, two presentations, and no
 * new machinery behind either: submitting navigates to `/shelf?q=…`.
 *
 * **The shelf *is* the search results.** There is no index, no overlay and no
 * API route, because the shelf already searches the whole collection, and a
 * navigation to it is a linkable, shareable URL — which is the invariant the
 * rest of the filter system is built on. `router.push`, not `replace`: this is
 * a deliberate move to another page and back should return you here, unlike a
 * filter change on the shelf itself, which rewrites the URL in place.
 *
 * The scope question the ticket raised is answered by *labelling*, not by a
 * mode switch. This box always searches everything and says so; a page's own
 * box (`FilterBar`) always filters that page and says so, and offers a link
 * here when the answer is not on it. A segmented "this page / everything"
 * toggle would be the thing that makes both ambiguous.
 */
export function SearchBox({ variant }: { variant: "header" | "hero" }) {
  const router = useRouter();
  const pathname = usePathname();
  const [term, setTerm] = useState("");
  const [open, setOpen] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const toggle = useRef<HTMLButtonElement>(null);

  // The phone form is not in the layout until it is opened, so focus has to
  // follow it in — a search you have to tap twice is a search nobody uses.
  useEffect(() => {
    if (open) input.current?.focus();
  }, [open]);

  /**
   * Close the phone panel and put focus back on the icon that opened it.
   * Closing applies `display:none` to the element holding focus, and the
   * browser's answer to that is `<body>` — a keyboard user who opens the
   * search and presses Escape would restart their next Tab from the top of
   * the document. `offsetParent` is the "is the icon actually on screen"
   * test: from `sm` up the icon is `display:none` and there is nothing to
   * hand focus back to, so the field just gives it up.
   */
  function collapse() {
    setOpen(false);
    const icon = toggle.current;
    if (icon && icon.offsetParent !== null) icon.focus();
    else input.current?.blur();
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    const q = term.trim();
    if (!q) return; // an empty submit is a no-op, not a trip to an unfiltered shelf
    collapse();
    router.push(`/shelf?q=${encodeURIComponent(q)}`);
  }

  // The shelf's own toolbar is a better search box for the shelf — it filters
  // as you type, without a round trip. Two boxes on that page is just noise.
  if (variant === "header" && pathname === "/shelf") return null;

  if (variant === "hero") {
    return (
      <form onSubmit={submit} role="search" aria-label="Search the whole collection" className="mt-4 flex items-center gap-2" data-testid="hero-search">
        <label className="relative min-w-0 flex-1">
          <span className="pointer-events-none absolute inset-y-0 left-3.5 flex items-center text-lg text-faint">⌕</span>
          <input
            ref={input}
            type="search"
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            placeholder="Search the collection"
            aria-label="Search the whole collection"
            className="h-12 w-full rounded-xl border border-border bg-surface pl-10 pr-3 text-base outline-none placeholder:text-faint focus:border-accent"
            data-testid="hero-search-input"
          />
        </label>
        <button type="submit" className="inline-flex h-12 shrink-0 items-center rounded-xl bg-accent px-4 text-sm font-semibold text-accent-ink transition hover:brightness-110" data-testid="hero-search-submit">
          Search
        </button>
      </form>
    );
  }

  return (
    <>
      {/* Phone: the icon only. The header row is already the hamburger, the
          wordmark and 390px — a second full input in it wrapped the wordmark
          onto a second line and burst the row. Tapping it drops the field in
          full width directly under the bar (the header is `sticky`, so it is
          the containing block for this absolute row). */}
      <button
        ref={toggle}
        type="button"
        // Without this the icon can never close the panel: pointerdown on the
        // button blurs the input first, the blur handler below has already set
        // `open` to false, and the click that follows toggles it straight back
        // open. Preventing the default keeps focus where it is, so no blur
        // fires and the click is the only thing that decides.
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => (open ? collapse() : setOpen(true))}
        aria-label="Search the whole collection"
        aria-expanded={open}
        aria-controls="header-search-panel"
        className={cx("ml-auto flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border text-lg transition sm:hidden", open ? "border-accent bg-surface-2 text-text" : "border-transparent text-muted hover:border-border hover:bg-surface-2")}
        data-testid="header-search-toggle"
      >
        <span aria-hidden>⌕</span>
      </button>
      {/* One form for both widths, so there is one input in the DOM and one
          thing to focus. `max-sm:` is the phone dress: hidden until the icon
          is tapped, then a full-width row beneath the bar. */}
      <form
        id="header-search-panel"
        onSubmit={submit}
        role="search"
        // Named, because home renders two search landmarks and a landmark list
        // that says "search, search" tells you nothing about either.
        aria-label="Search the whole collection from any page"
        className={cx("flex min-w-0 sm:ml-auto sm:max-w-56 sm:flex-1", "max-sm:absolute max-sm:inset-x-0 max-sm:top-full max-sm:border-b max-sm:border-border/70 max-sm:bg-bg max-sm:px-4 max-sm:py-3 max-sm:shadow-lg max-sm:shadow-black/40", open ? "" : "max-sm:hidden")}
        data-testid="header-search"
      >
        <label className="relative min-w-0 flex-1">
          <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-faint">⌕</span>
          <input
            ref={input}
            type="search"
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") collapse();
            }}
            onBlur={() => setOpen(false)}
            placeholder="Search all games"
            aria-label="Search the whole collection"
            className="h-11 w-full min-w-0 rounded-xl border border-border bg-surface pl-9 pr-3 text-base outline-none placeholder:text-faint focus:border-accent sm:h-9 sm:text-sm"
            data-testid="header-search-input"
          />
        </label>
      </form>
    </>
  );
}
