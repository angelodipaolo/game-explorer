"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { DEFAULT_FILTERS, parseFilters, serializeFilters, type Filters } from "@/lib/filters";

const VIEW_KEY = "shelf:view";
const SCROLL_PREFIX = "shelf:scroll:";

/**
 * Filter state is the URL. `set` merges a patch and replaces the URL without
 * scrolling. The view mode is also remembered in localStorage and restored
 * ONCE, on first mount, when the URL does not say — never on later changes,
 * or it would override the user's next click. The URL is rewritten only when
 * the user does something; Safari throttles history.replaceState and a
 * chatty effect can exhaust that budget and make every control look dead.
 */
/**
 * Remember the shelf's scroll position per URL and put it back when the same
 * URL is shown again (coming back from a game page). Browsers only restore
 * scroll on history navigations; this covers the link-based route too.
 */
export function useScrollMemory(key: string) {
  useEffect(() => {
    const storageKey = `${SCROLL_PREFIX}${key}`;
    let ready = false; // don't record until any restore has settled, or the mount-time scroll-to-top overwrites it
    let raf = 0;
    const arm = () => {
      ready = true;
    };
    try {
      const saved = Number(window.sessionStorage.getItem(storageKey) ?? "0");
      if (saved > 0) {
        let tries = 0;
        const attempt = () => {
          window.scrollTo(0, saved);
          if (Math.abs(window.scrollY - saved) > 2 && tries++ < 20) requestAnimationFrame(attempt);
          else setTimeout(arm, 100);
        };
        requestAnimationFrame(attempt);
      } else setTimeout(arm, 300);
    } catch {
      arm();
    }
    const onScroll = () => {
      if (!ready) return;
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        try {
          window.sessionStorage.setItem(storageKey, String(Math.round(window.scrollY)));
        } catch {}
      });
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      cancelAnimationFrame(raf);
    };
  }, [key]);
}

/**
 * Three opt-ins, all off by default, because this hook is shared by pages that
 * want very different things from it:
 *
 * - `scrollTopOnChange` is the shelf's: a filter change there is a screenful of
 *   different games and starts at the top. Flip has one card and no scroll
 *   memory, so it leaves it off and nothing moves.
 * - `rememberView` restores the covers/list choice from localStorage. **Only
 *   the shelf has that toggle.** Left on for every caller it would `router.replace`
 *   on mount of any page whose visitor had once chosen list view — a server
 *   round trip, on a page with no view to restore, to add a `view=list` param
 *   that means nothing there and then rides along in every link they share.
 * - `trackLastUrl` records where to come back to, which `BackLink` reads. The
 *   shelf and Flip are the places worth returning to; a page that opts in and
 *   is not one of them makes the game page's "◂ Shelf" link go somewhere else.
 */
export function useFilters({ scrollTopOnChange = false, rememberView = false, trackLastUrl = false }: { scrollTopOnChange?: boolean; rememberView?: boolean; trackLastUrl?: boolean } = {}): [Filters, (patch: Partial<Filters>) => void, () => void] {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const filters = parseFilters(params);
  const restored = useRef(false);

  useEffect(() => {
    try {
      if (trackLastUrl) window.sessionStorage.setItem("shelf:last", `${pathname}${serializeFilters(filters)}`);
      if (!rememberView) return;
      if (params.has("view")) {
        window.localStorage.setItem(VIEW_KEY, filters.view);
        restored.current = true;
      } else if (!restored.current) {
        restored.current = true;
        if (window.localStorage.getItem(VIEW_KEY) === "list") {
          router.replace(`${pathname}${serializeFilters({ ...filters, view: "list" })}`, { scroll: false });
        }
      } else {
        // The user chose the default (grid) after having list remembered.
        window.localStorage.setItem(VIEW_KEY, "grid");
      }
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params]);

  // Native replaceState: Next keeps useSearchParams in sync with it, and unlike
  // router.replace it does not re-render the server page (which would re-send
  // the whole collection on every keystroke).
  const apply = useCallback(
    (current: Filters, next: Filters) => {
      // Round-trip through the parser so one canonical string is the URL, the
      // comparison, and the scroll key. useScrollMemory is keyed off parsed
      // params, and the parser trims `q` while the search box does not — an
      // untrimmed key would be dead and its stale position would undo the jump.
      const normalized = parseFilters(new URLSearchParams(serializeFilters(next)));
      const qs = serializeFilters(normalized);
      window.history.replaceState(null, "", `${pathname}${qs}`);
      if (scrollTopOnChange && isNewResultSet(current, normalized)) jumpToTop(qs);
    },
    [pathname, scrollTopOnChange],
  );
  const set = useCallback(
    (patch: Partial<Filters>) => {
      const current = parseFilters(new URLSearchParams(window.location.search));
      apply(current, { ...current, ...patch });
    },
    [apply],
  );
  const reset = useCallback(() => {
    const current = parseFilters(new URLSearchParams(window.location.search));
    apply(current, { ...DEFAULT_FILTERS, view: current.view });
  }, [apply]);
  return [filters, set, reset];
}

/**
 * A filter change is a new set of games, so it starts at the top — the user is
 * looking at something else now, not the same list further down. Only a real
 * change counts: view (covers/list) shows the same games, and a patch that
 * changes nothing (re-picking the platform already picked) must not move the
 * page. Deliberately NOT an effect on the URL — back from a game page has to
 * land where it left, and scroll restoration owns that path.
 */
function isNewResultSet(current: Filters, next: Filters): boolean {
  return serializeFilters({ ...current, view: "grid" }) !== serializeFilters({ ...next, view: "grid" });
}

function jumpToTop(qs: string) {
  // Zero the new URL's remembered position first, or useScrollMemory would put
  // back where this filter was last left and undo the jump. The scroll itself
  // is also seen by the outgoing (still armed) listener, so the URL being left
  // behind records 0 too — which is what we want: coming back to it is another
  // filter change, and that starts at the top as well.
  try {
    window.sessionStorage.setItem(`${SCROLL_PREFIX}${qs}`, "0");
  } catch {}
  window.scrollTo({ top: 0, left: 0, behavior: "auto" });
}

/** Local text that writes to the URL a beat after typing stops, so the input never waits on anything. */
export function useDebouncedQuery(value: string, set: (patch: Partial<Filters>) => void, delay = 150): [string, (v: string) => void] {
  const [text, setText] = useState(value);
  const timer = useRef<number | null>(null);
  const last = useRef(value);
  // Follow external changes (Clear, presets) without clobbering in-flight typing.
  useEffect(() => {
    if (value !== last.current) {
      last.current = value;
      setText(value);
    }
  }, [value]);
  const update = useCallback(
    (v: string) => {
      setText(v);
      if (timer.current) window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => {
        last.current = v;
        set({ q: v });
      }, delay);
    },
    [set, delay],
  );
  return [text, update];
}
