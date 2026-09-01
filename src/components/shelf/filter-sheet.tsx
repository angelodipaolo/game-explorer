"use client";

import { useRef } from "react";
import type { Facets, Filters } from "@/lib/filters";
import type { Viewer } from "@/lib/viewer";
import { AuthMenu } from "@/components/auth-menu";
import { MODE_LABELS } from "@/lib/players";
import { Button, cx } from "@/components/ui";
import { Overlay } from "@/components/overlay";
import { FilterControls } from "./filter-controls";

/** One-tap ways in. The first is the flagship. Shared by the shelf and Flip. */
export const PRESETS: { label: string; hint: string; patch: Partial<Filters> }[] = [
  { label: `2 of us, ${MODE_LABELS.coop.toLowerCase()}`, hint: "NES", patch: { platforms: ["nes"], players: 2, mode: "coop" } },
  // The reason the play filter exists: a shelf this size hides the games you
  // have never actually put in the machine.
  { label: "Never played", hint: "not yet", patch: { play: "never" } },
  { label: "Head to head", hint: "versus", patch: { players: 2, mode: "versus" } },
  { label: "Just me", hint: "single player", patch: { players: 1 } },
  { label: "4 players", hint: "party", patch: { players: 4 } },
  { label: "Something quick", hint: "under an hour", patch: { length: "quick" } },
];

const CLEARED: Partial<Filters> = { q: "", platforms: [], hideHandhelds: false, players: null, mode: null, tags: [], length: null, era: null, play: null };

export function isPreset(p: (typeof PRESETS)[number], filters: Filters, active: number): boolean {
  return Object.entries(p.patch).every(([k, v]) => (Array.isArray(v) ? JSON.stringify(v) === JSON.stringify(filters[k as keyof Filters]) : filters[k as keyof Filters] === v)) && active === Object.keys(p.patch).length;
}

export function PresetRow({ filters, active, set, reset }: { filters: Filters; active: number; set: (p: Partial<Filters>) => void; reset: () => void }) {
  return (
    <div className="scrollbar-none -mx-4 flex gap-1.5 overflow-x-auto px-4">
      {PRESETS.map((p) => {
        const on = isPreset(p, filters, active);
        return (
          <button
            key={p.label}
            onClick={() => (on ? reset() : set({ ...CLEARED, ...p.patch }))}
            aria-pressed={on}
            className={cx("min-h-11 shrink-0 rounded-full border px-3 text-sm transition touch-manipulation", on ? "border-accent bg-accent text-accent-ink font-semibold" : "border-border bg-surface text-muted hover:text-text")}
            data-testid="preset"
          >
            {/* A token step down, not `opacity-60`: opacity is not inherited
                into the computed colour, so the hint used to render at
                4.30:1 (and 2.27:1 on the pressed chip's red) while the
                stylesheet still read as AA. On the pressed chip the hint
                keeps `--accent-ink` and steps back by weight instead. */}
            {p.label} <span className={on ? "font-normal" : "text-faint"}>· {p.hint}</span>
          </button>
        );
      })}
      {active ? (
        <button onClick={reset} className="min-h-11 min-w-11 shrink-0 rounded-full px-3 text-sm text-accent-2 hover:underline" data-testid="preset-clear">
          Clear
        </button>
      ) : null}
    </div>
  );
}

/**
 * The filter sheet: bottom sheet on phones, popover on larger screens. The
 * same one is used on the shelf and in Flip, so the two never drift.
 */
export function FilterSheet({ open, onClose, filters, facets, set, reset, active, confirmed, maybe, showPresets, viewer }: { open: boolean; onClose: () => void; filters: Filters; facets: Facets; set: (p: Partial<Filters>) => void; reset: () => void; active: number; confirmed: number; maybe: number; showPresets?: boolean; viewer: Viewer }) {
  // Focus lands on the panel itself rather than the backdrop button that
  // precedes it in the DOM, so the dialog's label is what a screen reader
  // announces. The backdrop is `tabIndex={-1}` and therefore out of the trap's
  // tab order: it is a pointer affordance that duplicates the visible ×, and
  // left tabbable it was where the first Tab landed — a full-screen unlabelled
  // "close" ahead of every filter.
  const panel = useRef<HTMLDivElement>(null);
  return (
    <Overlay open={open} onClose={onClose} label="Filters" className="z-40" initialFocus={panel} testId="filter-sheet">
      <button tabIndex={-1} className="absolute inset-0 bg-black/60" aria-label="Close filters" onClick={onClose} />
      <div ref={panel} tabIndex={-1} className="absolute inset-x-0 bottom-0 max-h-[88dvh] overflow-y-auto rounded-t-3xl border-t border-border bg-bg-elev p-5 pb-safe shadow-2xl outline-none sm:inset-auto sm:right-4 sm:top-16 sm:w-[28rem] sm:rounded-2xl sm:border">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-display text-lg font-bold">Narrow it down</h2>
          <div className="flex gap-2">
            {active ? (
              <Button variant="ghost" onClick={reset}>
                Clear
              </Button>
            ) : null}
            <Button variant="primary" onClick={onClose} data-testid="close-filters">
              Show {confirmed}
              {maybe ? ` (+${maybe})` : ""}
            </Button>
          </div>
        </div>
        {showPresets ? (
          <div className="mb-5">
            <PresetRow filters={filters} active={active} set={set} reset={reset} />
          </div>
        ) : null}
        <FilterControls filters={filters} facets={facets} set={set} />
        {/* The owner's way in and out, at the bottom of a sheet the public
            opens for filters. Renders nothing when no auth is configured. */}
        <AuthMenu viewer={viewer} className="mt-5 border-t border-border/60 pt-3" />
      </div>
    </Overlay>
  );
}
