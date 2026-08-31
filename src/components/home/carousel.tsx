"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { cx } from "@/components/ui";

/**
 * One row of cover art that scrolls sideways — no carousel library, and none
 * wanted.
 *
 * The scrolling is the browser's: `overflow-x: auto` with `scroll-snap-type: x
 * mandatory` (see `.carousel-scroll` in globals.css), which gives momentum on
 * iOS and arrow-key scrolling for free once the container is focusable. This
 * component adds only what CSS cannot: the two arrow buttons a mouse expects,
 * and knowing when to grey them out.
 *
 * The container is the *only* thing that scrolls horizontally. The page must
 * never — that is a standing rule for one-handed phone use, and it is why the
 * row bleeds to the edge with `-mx-4 px-4` inside its own overflow box rather
 * than being any wider than the page.
 */
export function Carousel({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [ends, setEnds] = useState({ start: true, end: true });

  const measure = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const max = el.scrollWidth - el.clientWidth;
    setEnds({ start: el.scrollLeft <= 1, end: el.scrollLeft >= max - 1 });
  }, []);

  useEffect(() => {
    measure();
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [measure]);

  const nudge = (dir: -1 | 1) => {
    const el = ref.current;
    if (el) el.scrollBy({ left: dir * Math.max(240, el.clientWidth * 0.8), behavior: "smooth" });
  };

  return (
    <div className={cx("group/carousel relative", className)}>
      <div
        ref={ref}
        onScroll={measure}
        // Focusable so the row is reachable by keyboard and scrolls with the
        // arrow keys; `role="region"` + the label say which row you are in.
        tabIndex={0}
        role="region"
        aria-label={label}
        // `scroll-pl-*` matches the padding: without it the mandatory snap
        // pulls the first cover under the page's left margin.
        className="carousel-scroll -mx-4 gap-3 px-4 pb-2 scroll-pl-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-2 sm:-mx-1 sm:px-1 sm:scroll-pl-1"
        data-testid="carousel"
      >
        {children}
      </div>
      <Arrow side="left" label={label} disabled={ends.start} onClick={() => nudge(-1)} />
      <Arrow side="right" label={label} disabled={ends.end} onClick={() => nudge(1)} />
    </div>
  );
}

function Arrow({ side, label, disabled, onClick }: { side: "left" | "right"; label: string; disabled: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={`Scroll ${label} ${side}`}
      className={cx(
        // `.pointer-only` hides it outright on a touch screen.
        "pointer-only absolute top-[38%] z-10 h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full border border-border bg-bg/85 text-lg text-text shadow-lg shadow-black/50 backdrop-blur transition",
        // Invisible until the row is hovered — and an invisible or disabled
        // arrow must not hit-test, or it eats the click on the left edge of the
        // first cover it is sitting on top of.
        "pointer-events-none opacity-0 group-hover/carousel:opacity-100",
        disabled ? "!opacity-0" : "group-hover/carousel:pointer-events-auto",
        side === "left" ? "-left-2" : "-right-2",
      )}
      data-testid={`carousel-${side}`}
    >
      <span aria-hidden>{side === "left" ? "‹" : "›"}</span>
    </button>
  );
}
