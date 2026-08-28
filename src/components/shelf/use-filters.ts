"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef } from "react";
import { DEFAULT_FILTERS, parseFilters, serializeFilters, type Filters } from "@/lib/filters";

const VIEW_KEY = "shelf:view";

/**
 * Filter state is the URL. `set` merges a patch and replaces the URL without
 * scrolling. The view mode is also remembered in localStorage and restored
 * ONCE, on first mount, when the URL does not say — never on later changes,
 * or it would override the user's next click. The URL is rewritten only when
 * the user does something; Safari throttles history.replaceState and a
 * chatty effect can exhaust that budget and make every control look dead.
 */
export function useFilters(): [Filters, (patch: Partial<Filters>) => void, () => void] {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const filters = parseFilters(params);
  const restored = useRef(false);

  useEffect(() => {
    try {
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
      window.sessionStorage.setItem("shelf:last", `${pathname}${serializeFilters(filters)}`);
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params]);

  const set = useCallback(
    (patch: Partial<Filters>) => {
      const next = { ...parseFilters(params), ...patch };
      router.replace(`${pathname}${serializeFilters(next)}`, { scroll: false });
    },
    [params, pathname, router],
  );
  const reset = useCallback(() => {
    const view = parseFilters(params).view;
    router.replace(`${pathname}${serializeFilters({ ...DEFAULT_FILTERS, view })}`, { scroll: false });
  }, [params, pathname, router]);
  return [filters, set, reset];
}
