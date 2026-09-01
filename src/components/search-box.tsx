"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { SearchIcon, cx } from "@/components/ui";
import { focusTrigger, useOverlay } from "@/components/overlay";

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
 *
 * **GAMEEXPLOR-0033 moved the phone/inline split from `sm` (640) to `md`
 * (768), and it is not a taste call.** At 640 the inline field measured 135×36
 * with 14px text — the `max-w-56` cap never bound, because four nav links and
 * a wordmark had already eaten the row — which is half the width the owner was
 * already calling "super small", under the 44px target GAMEEXPLOR-0023 set,
 * and under the 16px at which iOS stops zooming the page on focus. At 768 the
 * same field with `flex-1` measures 263px signed in and 333px signed out, so
 * iPad portrait keeps a real field; below that it is the 44px glyph, which is
 * a bigger target than the field it replaces. Every `md:` in this file is one
 * half of that split — they move together or not at all.
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

  /**
   * The fifth overlay, and the one that is deliberately NOT modal: this is a
   * disclosure under the header, not a dialog, so the page behind it stays
   * scrollable and interactive and Tab leads out of it (the input's `onBlur`
   * closes it on the way). `useOverlay` is here for the one thing it does owe
   * a keyboard — Escape — so there is no fifth hand-rolled key handler.
   *
   * `restoreFocus` stays off: `collapse` above already returns focus to the
   * icon, and a restore on every close would fight the blur-to-close path by
   * dragging focus back out of whatever you tabbed to.
   *
   * It only listens while the panel is `open`, which above `sm` it never is —
   * the field is simply in the header. The input keeps its own Escape handler
   * for that width; the two agree, because both call `collapse`.
   */
  const panel = useOverlay<HTMLFormElement>({ open, onClose: collapse, modal: false });

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

  /*
    Home is the other page that already has a search-everything box — the hero,
    which is the same control at three times the width — and two of them 100px
    apart is the whole of GAMEEXPLOR-0033. But the suppression only starts at
    `md`, deliberately: home is 4.3 screens tall on a 390px phone and the hero
    is not sticky, so removing the glyph outright would leave one flick between
    a reader and any search at all, with a two-tap recovery. A 44px glyph
    beside the wordmark is not a second search bar, and by the time it matters
    the hero is off-screen. From `md` up the hero is always the search you can
    see, so the header's field goes away.
  */
  const suppressed = variant === "header" && pathname === "/";

  if (variant === "hero") {
    return (
      <form onSubmit={submit} role="search" aria-label="Search all games" className="mt-4 flex items-center gap-2" data-testid="hero-search">
        <label className="relative min-w-0 flex-1">
          <span className="pointer-events-none absolute inset-y-0 left-3.5 flex items-center text-faint">
            <SearchIcon className="h-5 w-5" />
          </span>
          <input
            ref={input}
            type="search"
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            placeholder="Search all games"
            aria-label="Search all games"
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
      {/* Below `md`: the glyph only. The header row is already the hamburger,
          the wordmark and 390px — a second full input in it wrapped the
          wordmark onto a second line and burst the row — and at 640 the field
          that did fit was 135px wide, which is worse than no field. Tapping it
          drops the field in full width directly under the bar (the header is
          `sticky`, so it is the containing block for this absolute row). */}
      <button
        ref={toggle}
        type="button"
        // Without this the icon can never close the panel: pointerdown on the
        // button blurs the input first, the blur handler below has already set
        // `open` to false, and the click that follows toggles it straight back
        // open. Preventing the default keeps focus where it is, so no blur
        // fires and the click is the only thing that decides.
        onMouseDown={(e) => e.preventDefault()}
        onClick={(e) => {
          focusTrigger(e);
          if (open) collapse();
          else setOpen(true);
        }}
        aria-label="Search all games"
        aria-expanded={open}
        aria-controls="header-search-panel"
        className={cx("ml-auto flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border transition md:hidden", open ? "border-accent bg-surface-2 text-text" : "border-transparent text-muted hover:border-border hover:bg-surface-2")}
        data-testid="header-search-toggle"
      >
        <SearchIcon />
      </button>
      {/* One form for both widths, so there is one input in the DOM and one
          thing to focus. `max-md:` is the phone dress: hidden until the icon
          is tapped, then a full-width row beneath the bar. */}
      <form
        ref={panel}
        id="header-search-panel"
        onSubmit={submit}
        role="search"
        // Every *visible* name on this control is now the one name for the
        // job — "Search all games" — but the landmark keeps its qualifier:
        // below `md` on home this panel and the hero can be open at the same
        // time, and a landmark list that says "search, search" tells you
        // nothing about either.
        aria-label="Search all games from any page"
        className={cx("flex min-w-0 md:ml-auto md:max-w-sm md:flex-1", "max-md:absolute max-md:inset-x-0 max-md:top-full max-md:border-b max-md:border-border/70 max-md:bg-bg max-md:px-4 max-md:py-3 max-md:shadow-lg max-md:shadow-black/40", open ? "" : "max-md:hidden", suppressed ? "md:hidden" : "")}
        data-testid="header-search"
      >
        <label className="relative min-w-0 flex-1">
          <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-faint">
            <SearchIcon />
          </span>
          <input
            ref={input}
            type="search"
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            // Escape here as well as in `useOverlay`, and not instead of it:
            // the overlay only listens while `open` is true, and `open` is set
            // by the phone toggle alone. From `md` up the field is always in
            // the header and never "open", so without this line Escape from a
            // desktop search box did nothing at all (GAMEEXPLOR-0027 shipped
            // it; the overlay refactor took it away).
            onKeyDown={(e) => {
              if (e.key === "Escape") collapse();
            }}
            onBlur={() => setOpen(false)}
            placeholder="Search all games"
            aria-label="Search all games"
            // `h-11`/`text-base` at every width, not `sm:h-9 sm:text-sm`: this
            // field is the iPad's search and an iPad is a touch device, so 36px
            // missed the GAMEEXPLOR-0023 target bar, and 14px made iPadOS zoom
            // the whole page the moment it was focused.
            className="h-11 w-full min-w-0 rounded-xl border border-border bg-surface pl-9 pr-3 text-base outline-none placeholder:text-faint focus:border-accent"
            data-testid="header-search-input"
          />
        </label>
      </form>
    </>
  );
}
