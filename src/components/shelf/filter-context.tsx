"use client";

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { Filters } from "@/lib/filters";

/**
 * The seam that lets the global menu filter the shelf without navigating.
 *
 * The platform drawer lives in the header now (GAMEEXPLOR-0018), so on every
 * page but one its platform rows are ordinary links to `/shelf?platform=…`.
 * On the shelf that link would be a server round trip that re-sends the whole
 * collection — precisely what `use-filters.ts` exists to avoid — so the shelf
 * publishes its `set` here and the drawer calls it instead.
 *
 * Header and shelf are siblings under the page, not parent and child, so the
 * provider cannot live inside `Shelf`: `ShelfFilterScope` wraps both of them
 * in `/shelf/page.tsx` and the shelf registers into it on mount. Anywhere
 * without the scope the context reads null, which is what turns the rows back
 * into links.
 */
export type ShelfFilters = {
  /** Selected platform slugs — the only filter state the drawer draws. */
  platforms: string[];
  set: (patch: Partial<Filters>) => void;
};

export const ShelfFilterContext = createContext<ShelfFilters | null>(null);
const RegisterContext = createContext<((filters: ShelfFilters | null) => void) | null>(null);

/** Null off the shelf. Callers must handle that — it is the normal case. */
export function useShelfFilters(): ShelfFilters | null {
  return useContext(ShelfFilterContext);
}

export function ShelfFilterScope({ children }: { children: ReactNode }) {
  const [filters, setFilters] = useState<ShelfFilters | null>(null);
  return (
    <RegisterContext.Provider value={setFilters}>
      <ShelfFilterContext.Provider value={filters}>{children}</ShelfFilterContext.Provider>
    </RegisterContext.Provider>
  );
}

/**
 * Called by `Shelf`. The filters object is parsed fresh from the URL on every
 * render, so publishing it by identity would re-register on every keystroke;
 * the bridge is keyed off the one value the drawer actually reads.
 */
export function useRegisterShelfFilters(platforms: string[], set: (patch: Partial<Filters>) => void) {
  const register = useContext(RegisterContext);
  const key = platforms.join(",");
  const value = useMemo<ShelfFilters>(() => ({ platforms: key ? key.split(",") : [], set }), [key, set]);
  useEffect(() => {
    if (!register) return;
    register(value);
    return () => register(null);
  }, [register, value]);
}
