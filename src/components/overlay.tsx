"use client";

import { useEffect, useRef, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import { cx } from "@/components/ui";

/**
 * The one overlay primitive (GAMEEXPLOR-0023). The main menu, the filter
 * sheet, the screenshot viewer, the journal photo viewer and the phone search
 * panel all went through here, because five hand-rolled focus traps is how
 * four of them drift and only the one somebody tested keeps working.
 *
 * A modal overlay owes a keyboard four things and a thumb one more:
 *
 *  1. focus moves into it when it opens,
 *  2. Tab and Shift+Tab stay inside it until it closes,
 *  3. Escape closes it,
 *  4. focus goes back to the control that opened it,
 *  5. the page behind it neither scrolls nor takes a tap.
 *
 * (5) is two mechanisms, not one. `overflow: hidden` on the body stops the
 * scroll; `inert` on every *other* child of the body stops the clicks and the
 * focus — which matters because a full-screen backdrop only blocks the pointer,
 * and a screen reader will happily walk straight past it.
 *
 * The phone search panel is the deliberate exception: it is a disclosure under
 * the header, not a modal, so it passes `modal: false` and keeps the page live
 * behind it. It gets Escape and nothing else, and restores focus itself (see
 * `search-box.tsx`) because closing on blur must not fight a focus restore.
 */

const FOCUSABLE = [
  "a[href]",
  "area[href]",
  "button:not([disabled])",
  'input:not([disabled]):not([type="hidden"])',
  "select:not([disabled])",
  "textarea:not([disabled])",
  "iframe",
  "audio[controls]",
  "video[controls]",
  "summary",
  '[tabindex]:not([tabindex="-1"])',
  '[contenteditable="true"]',
].join(",");

/** On screen and able to take focus. `getClientRects` is the honest test: it is false for `display:none`, `visibility:hidden` and a zero-size box alike. */
function onScreen(el: Element): boolean {
  return el.isConnected && el.getClientRects().length > 0;
}

function tabbables(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(onScreen);
}

/*
  Scroll lock, counted. Two overlays can be open at once (the filter sheet over
  a shelf whose menu is closing), and the naive pair of effects has the second
  one's cleanup unlock the page while the first is still up.

  The gutter is measured *before* the lock and replaced with padding. Without
  it, hiding the body's overflow removes the desktop scrollbar and the whole
  page — including the sticky header — jumps sideways by 15px the moment a
  menu opens.
*/
let locks = 0;
let releaseBody: (() => void) | null = null;

function lockScroll(): void {
  if (locks++ > 0) return;
  const body = document.body;
  const overflow = body.style.overflow;
  const paddingRight = body.style.paddingRight;
  const gutter = window.innerWidth - document.documentElement.clientWidth;
  body.style.overflow = "hidden";
  if (gutter > 0) body.style.paddingRight = `${gutter}px`;
  releaseBody = () => {
    body.style.overflow = overflow;
    body.style.paddingRight = paddingRight;
  };
}

function unlockScroll(): void {
  if (--locks > 0) return;
  locks = 0;
  releaseBody?.();
  releaseBody = null;
}

/** `inert` on every body child that is not the overlay (or its ancestor). Returns the undo. */
function inertBackground(container: HTMLElement): () => void {
  const undo: (() => void)[] = [];
  for (const el of Array.from(document.body.children)) {
    if (el === container || el.contains(container) || el.hasAttribute("inert")) continue;
    el.setAttribute("inert", "");
    undo.push(() => el.removeAttribute("inert"));
  }
  return () => undo.forEach((f) => f());
}

export type OverlayOptions = {
  open: boolean;
  onClose: () => void;
  /** Escape closes. Default true. */
  escape?: boolean;
  /** Trap Tab, lock the page's scroll, and inert everything behind it. Default true. */
  modal?: boolean;
  /** Put focus back where it came from on close. Defaults to `modal`. */
  restoreFocus?: boolean;
  /** Where focus lands on open. Defaults to the first tabbable in the overlay. */
  initialFocus?: RefObject<HTMLElement | null>;
  /** Where focus lands on close. Defaults to whatever had it when the overlay opened. */
  restoreTo?: RefObject<HTMLElement | null>;
};

/**
 * Attach the returned ref to the overlay's outermost element. Everything above
 * is wired to it for as long as `open` is true.
 */
export function useOverlay<T extends HTMLElement = HTMLDivElement>({ open, onClose, escape = true, modal = true, restoreFocus = modal, initialFocus, restoreTo }: OverlayOptions): RefObject<T | null> {
  const ref = useRef<T>(null);
  // The close callback is nearly always an inline arrow. Reading it through a
  // ref keeps the effect from tearing down and rebuilding the trap — and
  // re-running the focus move — on every render of the page behind it.
  const close = useRef(onClose);
  useEffect(() => {
    close.current = onClose;
  });

  useEffect(() => {
    const container = ref.current;
    if (!open || !container) return;

    /*
      Safari does not focus a `<button>` when you click it, so the opener is
      often `<body>` here. Every trigger in this app calls `focusTrigger`
      below to make itself the active element first; `restoreTo` is the
      explicit override for the cases that cannot.
    */
    const opener = restoreTo?.current ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);
    const releaseInert = modal ? inertBackground(container) : null;
    if (modal) lockScroll();

    if (modal) {
      if (!container.hasAttribute("tabindex")) container.tabIndex = -1;
      (initialFocus?.current ?? tabbables(container)[0] ?? container).focus();
    }

    // Capture phase: this beats a page-level `keydown` listener (the manual
    // viewer has one) that would otherwise act on the same Escape.
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && escape) {
        e.stopPropagation();
        close.current();
        return;
      }
      if (!modal || e.key !== "Tab") return;
      /*
        Every Tab is handled here, not just the two that wrap. Letting the
        browser move focus "normally" in the middle of the list is what makes a
        trap engine-dependent: Safari does not tab to links or buttons at all
        unless full keyboard access is on, so a trap that only intercepts the
        edges leaks on the one browser this app is actually read in. Moving
        focus ourselves costs nothing and behaves the same everywhere.
      */
      e.preventDefault();
      const items = tabbables(container);
      if (!items.length) {
        container.focus();
        return;
      }
      const active = document.activeElement;
      const from = active instanceof HTMLElement ? items.indexOf(active) : -1;
      const step = e.shiftKey ? -1 : 1;
      const next = from === -1 ? (e.shiftKey ? items.length - 1 : 0) : (from + step + items.length) % items.length;
      items[next].focus();
    };

    // The belt to the Tab handler's braces: a click on an inert background is
    // ignored, but focus can still arrive from outside the document (the
    // browser's own chrome, a Tab out of the URL bar).
    const onFocusIn = (e: FocusEvent) => {
      if (!modal || container.contains(e.target as Node)) return;
      (tabbables(container)[0] ?? container).focus();
    };

    document.addEventListener("keydown", onKeyDown, true);
    document.addEventListener("focusin", onFocusIn);

    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      document.removeEventListener("focusin", onFocusIn);
      releaseInert?.();
      if (modal) unlockScroll();
      if (!restoreFocus) return;
      // The trigger can be gone (a link inside the overlay navigated) or
      // hidden at this width (the search icon above `sm`). Handing focus to a
      // detached node silently drops it on `<body>`, which restarts the next
      // Tab at the top of the document.
      if (opener && onScreen(opener)) opener.focus();
      else if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    };
  }, [open, escape, modal, restoreFocus, initialFocus, restoreTo]);

  return ref;
}

/**
 * Safari does not move focus to a `<button>` on click, so an overlay opened by
 * one has nothing to hand focus back to. Every trigger calls this.
 */
export function focusTrigger(e: { currentTarget: HTMLElement }): void {
  e.currentTarget.focus();
}

/**
 * The overlay itself: portalled to the body, wired by `useOverlay`.
 *
 * The portal is load-bearing twice over. `SiteHeader`'s `backdrop-blur` makes
 * it a containing block for `fixed` descendants, so a drawer rendered in place
 * under it is 44px tall; and `inert`-ing the background only works if the
 * overlay is a sibling of the page rather than a node inside it.
 */
export function Overlay({
  open,
  onClose,
  label,
  className,
  children,
  onClick,
  initialFocus,
  restoreTo,
  escape = true,
  testId,
}: {
  open: boolean;
  onClose: () => void;
  label: string;
  className?: string;
  children: ReactNode;
  /** For an overlay where tapping anywhere dismisses it (the screenshot viewer). */
  onClick?: () => void;
  initialFocus?: RefObject<HTMLElement | null>;
  restoreTo?: RefObject<HTMLElement | null>;
  escape?: boolean;
  testId?: string;
}) {
  const ref = useOverlay<HTMLDivElement>({ open, onClose, escape, initialFocus, restoreTo });
  if (!open || typeof document === "undefined") return null;
  return createPortal(
    <div ref={ref} className={cx("fixed inset-0", className)} role="dialog" aria-modal="true" aria-label={label} onClick={onClick} data-overlay="" data-testid={testId}>
      {children}
    </div>,
    document.body,
  );
}
