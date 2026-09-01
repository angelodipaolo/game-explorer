"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { Filters } from "@/lib/filters";
import { SearchIcon, cx } from "@/components/ui";
import { useDebouncedQuery } from "@/components/shelf/use-filters";

/**
 * The narrow-this-page search (GAMEEXPLOR-0033), used by `FilterBar` on
 * `/playing` and `/series/[slug]` — the two surfaces that show a *subset* of
 * the collection and therefore have something to narrow.
 *
 * **The rule it exists to enforce: at rest, the two search controls never have
 * the same shape on the same screen.** From `md` up the header carries a
 * labelled "Search all games" field, so this one is a bare glyph; below `md`
 * the header is a 44px glyph beside the wordmark, so this one stays the
 * labelled field it has always been. Exactly one of the pair is prose at any
 * width, which is a far louder signal than making one box smaller than the
 * other — and it avoids the trap of two anonymous magnifiers 90px apart on a
 * 390px phone, which is the ticket's own complaint wearing a different hat.
 *
 * *At rest* is the whole of the qualifier, and it is deliberate: expanding
 * this field from `md` up does put two prose fields on screen at once. That is
 * fine and it is not the reported problem — the second one is there because
 * the reader just asked for it, it is named for the page it narrows rather
 * than for the collection, and it goes away on blur. What the ticket is about
 * is what a page *offers* you before you touch anything.
 *
 * That responsive half is CSS, not state: there is one input in the DOM at
 * every width, and `md:hidden` is what decides whether the collapsed
 * presentation is allowed to replace it. Measuring the viewport in JS would
 * mean a first paint at the wrong shape and a control that changes under a
 * rotating iPad only after React notices.
 *
 * **It writes filter state through `set` and through nothing else.** No
 * `history`, no `router`: `use-filters.ts` owns the one `replaceState` that
 * keeps a filter change from re-rendering the server page and re-sending the
 * whole collection. And the collapsed/expanded state is deliberately *not* in
 * the URL — two links to the same games must not differ.
 */
export function FilterSearch({ filters, set, label }: { filters: Filters; set: (patch: Partial<Filters>) => void; label: string }) {
  const [text, setText, flush] = useDebouncedQuery(filters.q, set);
  // Already trimmed: `parseFilters` does it on the way out of the URL. This is
  // the *committed* term, which is what the collapsed presentations show.
  const term = filters.q;
  const [open, setOpen] = useState(false);
  const fieldId = useId();
  const input = useRef<HTMLInputElement>(null);
  const toggle = useRef<HTMLButtonElement>(null);
  const chip = useRef<HTMLButtonElement>(null);
  const restore = useRef(false);

  /**
   * Hand focus to whichever collapsed control took the field's place — and do
   * it a render late, on purpose. Collapsing and clearing both decide the next
   * shape of this row with state, so at the moment the handler runs, the
   * element that is about to receive focus is still `display:none` and
   * `.focus()` on it does nothing at all: the browser's answer is `<body>`, and
   * a keyboard user's next Tab restarts from the top of the document. Waiting
   * for the render that makes it visible is the whole fix.
   */
  useEffect(() => {
    if (!restore.current) return;
    restore.current = false;
    const back = [chip.current, toggle.current].find((el) => el && el.offsetParent !== null);
    if (back) back.focus();
    else input.current?.blur();
  }, [open, term]);

  // From `md` up the field is not in the layout until it is opened, so focus
  // has to follow it in — a search you have to tap twice is a search nobody
  // uses. Re-opening from the chip puts the caret at the end rather than
  // selecting the term, so the next keystroke extends it instead of erasing it.
  useEffect(() => {
    if (!open) return;
    const el = input.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, [open]);

  /**
   * Put the field away, keeping the term, and hand focus back (see above).
   * Only Escape and the glyph itself call this — a blur must not, or clicking
   * anything else on the page would drag focus back into this row.
   */
  function collapse() {
    restore.current = true;
    setOpen(false);
  }

  const collapsedLabel = term ? `${label}: ${term}` : label;

  return (
    <form
      role="search"
      // Named, because `/playing` and `/series/[slug]` render this landmark
      // alongside the header's, and a landmark list that says "search, search"
      // tells you nothing about either.
      aria-label={label}
      // Enter has nowhere to go: the term is already in the URL a beat after
      // it was typed. Without this the browser would treat it as a GET form
      // and navigate, dropping every other filter on the way.
      onSubmit={(e) => e.preventDefault()}
      /*
        `flex-1` in **every** state, and this is the one line in this file that
        has to be justified rather than described. It was `md:flex-none` while
        collapsed, which grouped the glyph and `Filters` neatly at the left —
        and made `Filters` unclickable while the field was open. Blur fires on
        *mousedown*: reaching for `Filters` collapsed the form between the press
        and the release, the button jumped 1122px at 1280, and the click landed
        on nothing. The second attempt worked, so it read as flakiness rather
        than as a bug.

        The row is therefore `[control]……[Filters]` at every width and in every
        state. `Filters` does not move because the search changed shape, which
        is the same layout-thrash rule that keeps `Filters` on screen when the
        field is focused at 390px. A control that moves under the pointer is
        broken; a control that stays put is merely a different arrangement.
      */
      className="flex min-w-0 flex-1 items-center gap-1.5"
      data-testid="filter-search"
    >
      {/* The collapsed glyph. Always mounted so `collapse()` has something to
          hand focus back to; `md:` is what lets it exist at all, and a term
          swaps it for the chip so an active filter is never hidden behind an
          anonymous icon. `text-muted`, not `text-faint`: this is a control
          whose glyph is its entire meaning. */}
      <button
        ref={toggle}
        type="button"
        // The same guard `search-box.tsx` carries, for the same reason: this
        // button is about to become `display:none` — the field takes its place
        // in the row rather than dropping below it — and a browser that has
        // already given it focus hands that focus to `<body>` the moment it
        // goes. Preventing the default leaves focus where it was until the
        // effect above moves it into the field. There is no close branch for
        // the same reason: once the field is here, this glyph is not.
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => setOpen(true)}
        aria-label={label}
        aria-expanded={open}
        aria-controls={fieldId}
        className={cx("hidden h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-transparent text-muted transition hover:border-border hover:bg-surface-2 hover:text-text", open || term ? "" : "md:inline-flex")}
        data-testid="filter-search-toggle"
      >
        <SearchIcon />
      </button>
      {/* The chip: the same treatment as a pressed genre chip, because it is
          the same thing — one filter, switched on, sitting in a row of them.
          The ✕ is its own 44px target rather than a 16px hit area inside the
          pill, so clearing and re-opening are not the same gesture. */}
      {term ? (
        <span className={cx("hidden items-center gap-1", open ? "" : "md:inline-flex")}>
          <button
            ref={chip}
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => setOpen(true)}
            aria-label={collapsedLabel}
            aria-expanded={open}
            aria-controls={fieldId}
            className="inline-flex min-h-11 max-w-56 items-center gap-1.5 rounded-full border border-accent-2 bg-accent-2/15 px-3 text-sm font-semibold text-accent-2"
            data-testid="filter-search-chip"
          >
            <SearchIcon className="h-4 w-4" />
            <span className="truncate">{term}</span>
          </button>
          <button
            type="button"
            onClick={() => {
              restore.current = true;
              setText("");
              flush();
            }}
            aria-label={`Clear ${label.toLowerCase()}`}
            className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-lg text-muted transition hover:bg-surface-2 hover:text-text"
            data-testid="filter-search-clear"
          >
            <span aria-hidden>✕</span>
          </button>
        </span>
      ) : null}
      {/* The field itself. Below `md` it is simply always here — the row is
          `[input flex-1][Filters · N]`, which is what it has always been and
          which measures 277px on a 390px phone, so nothing has to disappear on
          focus to make room. From `md` up it is the expanded state. */}
      <label className={cx("relative min-w-0 flex-1", open ? "" : "md:hidden")}>
        <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-faint">
          <SearchIcon />
        </span>
        <input
          ref={input}
          id={fieldId}
          type="search"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key !== "Escape") return;
            // Escape puts the field away and *keeps* the term, and
            // `preventDefault` is what makes that true: a native
            // `<input type="search">` treats Escape as "empty me", so without
            // this line the keystroke that was only supposed to close the
            // field destroyed the filter as well. A filter that disappears
            // without being asked to is the failure this codebase is most
            // careful about. Escape here means what it means in every other
            // overlay in the app: put this away.
            e.preventDefault();
            flush();
            collapse();
          }}
          onBlur={() => {
            // Commit before collapsing, or the chip that replaces this field
            // would show the term as it was 150ms ago while the rows below it
            // are already filtered by the new one.
            flush();
            setOpen(false);
          }}
          placeholder={label}
          aria-label={label}
          className="h-11 w-full min-w-0 rounded-xl border border-border bg-surface pl-9 pr-3 text-base outline-none placeholder:text-faint focus:border-accent"
          data-testid="filter-search-input"
        />
      </label>
    </form>
  );
}
