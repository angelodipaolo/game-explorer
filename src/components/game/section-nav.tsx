"use client";

import { useEffect, useRef, useState } from "react";
import { cx } from "@/components/ui";
import { openSection } from "@/components/game/section";

export type NavSection = { id: string; label: string };

/**
 * A sticky row of jump-to chips under the site header, one per drawer that
 * actually exists on this game. Collapsing sections (step 1-6) shortens the
 * page, which makes *reaching* one worse — a scroll plus a tap — so this is
 * the other half of that trade.
 *
 * Rendered where the header block ends: the sentinel div right here in the
 * DOM is what an `IntersectionObserver` watches, rather than a scroll
 * listener, to decide when the header has scrolled out of view. The bar
 * itself only mounts once that happens, `position: sticky` right under
 * `SiteHeader` (44px, same as its own height, so they never overlap).
 */
export function SectionNav({ sections }: { sections: NavSection[] }) {
  const sentinelRef = useRef<HTMLDivElement>(null);
  const [pastHeader, setPastHeader] = useState(false);
  const [active, setActive] = useState<string | null>(null);

  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const obs = new IntersectionObserver(([entry]) => setPastHeader(!entry.isIntersecting));
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  useEffect(() => {
    if (!pastHeader || !sections.length) return;
    const targets = sections.map((s) => document.getElementById(s.id)).filter((e): e is HTMLElement => e != null);
    if (!targets.length) return;
    const obs = new IntersectionObserver(
      (entries) => {
        // Of every section header currently on screen, the one closest to the
        // top (just under the two sticky bars) is "the one you are reading".
        const onScreen = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (onScreen[0]) setActive(onScreen[0].target.id);
      },
      // Top offset clears the site header (44px) plus this bar (44px); the
      // generous bottom margin means a section only has to reach the upper
      // part of the screen to count as "in view", not fill it.
      { rootMargin: "-92px 0px -65% 0px", threshold: 0 },
    );
    targets.forEach((t) => obs.observe(t));
    return () => obs.disconnect();
  }, [pastHeader, sections]);

  return (
    <>
      <div ref={sentinelRef} aria-hidden />
      {pastHeader ? (
        <div className="sticky top-11 z-20 -mx-4 border-b border-border/70 bg-bg/90 px-4 backdrop-blur" data-testid="section-nav">
          <div className="scrollbar-none flex gap-1.5 overflow-x-auto py-1.5">
            {sections.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => openSection(s.id)}
                className={cx(
                  "min-h-9 shrink-0 rounded-full border px-3 text-xs whitespace-nowrap transition",
                  active === s.id ? "border-accent bg-accent/15 text-accent" : "border-border text-muted hover:border-muted hover:text-text",
                )}
                data-testid="section-nav-chip"
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </>
  );
}
