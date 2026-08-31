"use client";

import { useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { cx } from "@/components/ui";

/**
 * A shared shell for every drawer below the fold on the game page: a header
 * row (chevron · title · count · action), and a body that collapses under it.
 *
 * Open state persists in `localStorage`, **global rather than per game** —
 * "I always want Codes open" is a preference about you, not about one
 * cartridge. Reading it goes through `useSyncExternalStore` rather than a
 * `useEffect` + `setState`: the server has no `localStorage` to read, so its
 * snapshot is `null` (meaning "nothing stored yet, fall back to
 * `defaultOpen`"), and React itself reconciles the real value once this
 * mounts on the client — the documented way to read browser-only state
 * without a hydration mismatch, and the one the lint rule against
 * setState-in-an-effect steers you toward.
 *
 * Collapsed content stays mounted with the `hidden` attribute instead of being
 * unmounted, on purpose: find-in-page still finds it, and state inside a
 * collapsed CodeList or Journal (an open form, a typed draft) survives the
 * section being closed.
 *
 * `id` doubles as the scroll anchor the jump bar (step 7) targets and as the
 * key the same jump bar uses to ask this section to open — see
 * `section-nav.tsx` for the small event it dispatches. `testId` is separate
 * from `id` because several sections carry a `data-testid` older than this
 * component (`code-list`, `bookmarks`, …) that has to stay put for existing
 * assertions and selectors.
 */

const STORAGE_PREFIX = "ge:section:";
/** Fired after a write, so every mounted Section watching this key re-reads it — `localStorage`'s own `storage` event only fires in *other* tabs. */
const STORAGE_WRITE_EVENT = "ge:section-storage";
/** The event `section-nav.tsx` dispatches to ask a section to open and scroll into view. */
export const OPEN_SECTION_EVENT = "ge:open-section";

function readStored(storageKey: string): string | null {
  try {
    return window.localStorage.getItem(STORAGE_PREFIX + storageKey);
  } catch {
    return null;
  }
}

function writeStored(storageKey: string, open: boolean) {
  try {
    window.localStorage.setItem(STORAGE_PREFIX + storageKey, open ? "1" : "0");
  } catch {
    // Best effort — the toggle still works for this render, just not remembered.
  }
  window.dispatchEvent(new CustomEvent(STORAGE_WRITE_EVENT, { detail: { storageKey } }));
}

function subscribeStored(storageKey: string, cb: () => void) {
  const onWrite = (e: Event) => {
    if ((e as CustomEvent<{ storageKey: string }>).detail?.storageKey === storageKey) cb();
  };
  window.addEventListener(STORAGE_WRITE_EVENT, onWrite);
  return () => window.removeEventListener(STORAGE_WRITE_EVENT, onWrite);
}

const SERVER_SNAPSHOT = null;

export function Section({
  id,
  title,
  count,
  collapsible = false,
  defaultOpen = true,
  storageKey,
  action,
  emptyAction,
  forceOpen = false,
  testId,
  className,
  children,
}: {
  id: string;
  title: string;
  count?: number;
  collapsible?: boolean;
  defaultOpen?: boolean;
  storageKey?: string;
  action?: ReactNode;
  /**
   * Rendered in the header instead of `action`, and only while the section is
   * *closed* — the "+ code" / "+ link" affordance a section with nothing in
   * it shows so the resting, collapsed row still has something to tap
   * (GAMEEXPLOR-0023 round 2, item E). `action` (Edit) only makes sense once
   * there is something open to edit, so the two are never shown at once.
   */
  emptyAction?: ReactNode;
  forceOpen?: boolean;
  testId?: string;
  className?: string;
  children: ReactNode;
}) {
  // `null` on the server and on the very first client render (before
  // hydration can know what is in localStorage); the real "0"/"1" once it can.
  const stored = useSyncExternalStore(
    (cb) => (storageKey ? subscribeStored(storageKey, cb) : () => {}),
    () => (storageKey ? readStored(storageKey) : null),
    () => SERVER_SNAPSHOT,
  );
  // A manual toggle, or the jump bar asking this section to open, overrides
  // whatever storage or `defaultOpen` would otherwise say for this render.
  const [override, setOverride] = useState<boolean | null>(null);

  const open = !collapsible ? true : (override ?? (forceOpen ? true : stored != null ? stored === "1" : defaultOpen));

  // The jump bar (step 7) asks a section to open (if it can be closed) and
  // scroll to it. A jump that lands on a closed accordion is a dead end, so
  // this listens for its own id and does both — a non-collapsible section
  // (Screenshots, Maps, Manual) still has something to scroll to, it just has
  // nothing to open.
  useEffect(() => {
    const onOpen = (e: Event) => {
      const detail = (e as CustomEvent<{ id: string }>).detail;
      if (detail?.id !== id) return;
      if (collapsible) setOverride(true);
      requestAnimationFrame(() => {
        document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    };
    window.addEventListener(OPEN_SECTION_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_SECTION_EVENT, onOpen);
  }, [collapsible, id]);

  function toggle() {
    if (!collapsible) return;
    const next = !open;
    setOverride(next);
    if (storageKey) writeStored(storageKey, next);
  }

  return (
    <section id={id} className={cx("mt-8 border-t border-border/60 pt-5 scroll-mt-20", className)} data-testid={testId}>
      <div
        role={collapsible ? "button" : undefined}
        tabIndex={collapsible ? 0 : undefined}
        aria-expanded={collapsible ? open : undefined}
        aria-controls={collapsible ? `${id}-body` : undefined}
        onClick={collapsible ? toggle : undefined}
        onKeyDown={
          collapsible
            ? (e) => {
                if (e.key !== "Enter" && e.key !== " ") return;
                e.preventDefault();
                toggle();
              }
            : undefined
        }
        className={cx(
          "mb-3 flex min-h-11 items-center gap-2",
          collapsible && "-mx-2 cursor-pointer select-none rounded-lg px-2 transition-colors hover:bg-surface-2/60 active:bg-surface-2",
        )}
        data-testid={`section-toggle-${id}`}
      >
        {collapsible ? (
          <span aria-hidden className={cx("inline-block shrink-0 text-sm text-muted transition-transform duration-200", open && "rotate-90")}>
            ▸
          </span>
        ) : null}
        <h2 className="font-display text-lg font-bold">
          {title}
          {count ? <span className="ml-1 text-base font-normal text-muted">· {count}</span> : null}
        </h2>
        {(open ? action : emptyAction) ? (
          <span className="ml-auto" onClick={(e) => e.stopPropagation()}>
            {open ? action : emptyAction}
          </span>
        ) : null}
      </div>
      <div id={`${id}-body`} hidden={collapsible && !open}>
        {children}
      </div>
    </section>
  );
}

/** Ask the section with this `id` to open and scroll into view. Used by `section-nav.tsx`. */
export function openSection(id: string) {
  window.dispatchEvent(new CustomEvent(OPEN_SECTION_EVENT, { detail: { id } }));
}
