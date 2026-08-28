"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo } from "react";
import { DEFAULT_FILTERS, parseFilters, serializeFilters, type Filters } from "@/lib/filters";

const VIEW_KEY = "shelf:view";

/**
 * Filter state is the URL. `set` merges a patch and replaces the URL without
 * scrolling; the view mode is also remembered in localStorage so it survives
 * a bare visit to "/".
 */
export function useFilters(): [Filters, (patch: Partial<Filters>) => void, () => void] {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const filters = useMemo(() => parseFilters(params), [params]);

  // Remember the view mode. When the URL does not say, restore the saved one by
  // rewriting the URL after hydration (never during render, or the server and
  // client would disagree).
  useEffect(() => {
    try {
      if (params.has("view")) {
        window.localStorage.setItem(VIEW_KEY, filters.view);
      } else if (window.localStorage.getItem(VIEW_KEY) === "list") {
        router.replace(`${pathname}${serializeFilters({ ...filters, view: "list" })}`, { scroll: false });
      } else {
        window.localStorage.setItem(VIEW_KEY, "grid");
      }
    } catch {}
  }, [params, filters, pathname, router]);

  useEffect(() => {
    try {
      window.sessionStorage.setItem("shelf:last", `${pathname}${serializeFilters(filters)}`);
    } catch {}
  }, [pathname, filters]);

  const set = useCallback(
    (patch: Partial<Filters>) => {
      const next = { ...filters, ...patch };
      router.replace(`${pathname}${serializeFilters(next)}`, { scroll: false });
    },
    [filters, pathname, router],
  );
  const reset = useCallback(() => router.replace(`${pathname}${serializeFilters({ ...DEFAULT_FILTERS, view: filters.view })}`, { scroll: false }), [filters.view, pathname, router]);
  return [filters, set, reset];
}
