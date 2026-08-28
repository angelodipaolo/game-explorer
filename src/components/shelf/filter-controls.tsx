"use client";

import type { Facets, Filters } from "@/lib/filters";
import { cx } from "@/components/ui";

/** The filter controls, laid out for thumbs. Used inline on desktop and inside the sheet on phones. */
export function FilterControls({ filters, facets, set }: { filters: Filters; facets: Facets; set: (patch: Partial<Filters>) => void }) {
  return (
    <div className="grid gap-5">
      <Group label="How many of us?">
        <Segmented value={filters.players} onChange={(v) => set({ players: v })} options={[[1, "Just me"], [2, "2"], [3, "3"], [4, "4+"]]} />
      </Group>
      <Group label="Playing how?">
        <Segmented
          value={filters.mode}
          onChange={(v) => set({ mode: v })}
          options={[
            ["coop", "Co-op"],
            ["versus", "Versus"],
            ["together", "At the same time"],
          ]}
        />
      </Group>
      <Group label="Platform">
        <Chips value={filters.platform} onChange={(v) => set({ platform: v })} options={facets.platforms.map((p) => [p.slug, `${p.label} · ${p.count}`])} />
      </Group>
      <Group label="Kind of game">
        <Chips value={filters.genre} onChange={(v) => set({ genre: v })} options={facets.genres.slice(0, 14).map((g) => [g.name, `${g.name} · ${g.count}`])} />
      </Group>
      <Group label="How long have we got?">
        <Segmented
          value={filters.length}
          onChange={(v) => set({ length: v })}
          options={[
            ["quick", "Under an hour"],
            ["evening", "An evening"],
            ["long", "A saga"],
          ]}
        />
      </Group>
      <Group label="Era">
        <Segmented
          value={filters.era}
          onChange={(v) => set({ era: v })}
          options={[
            ["80s", "80s"],
            ["90s", "90s"],
            ["00s", "00s"],
            ["10s", "10s+"],
          ]}
        />
      </Group>
      <label className="flex items-center gap-3 rounded-xl border border-border bg-bg-elev px-3 py-2.5 text-sm">
        <input type="checkbox" checked={filters.strict} onChange={(e) => set({ strict: e.target.checked })} className="h-5 w-5 accent-[var(--accent)]" />
        <span>
          Only games with confirmed data
          <span className="block text-xs text-muted">Off by default: most of the shelf has no exact player counts yet.</span>
        </span>
      </label>
    </div>
  );
}

function Group({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">{label}</div>
      {children}
    </div>
  );
}

function Segmented<T extends string | number>({ value, onChange, options }: { value: T | null; onChange: (v: T | null) => void; options: [T, string][] }) {
  return (
    <div className="flex flex-wrap gap-1.5" role="group">
      {options.map(([v, label]) => (
        <button
          key={String(v)}
          type="button"
          aria-pressed={value === v}
          onClick={() => onChange(value === v ? null : v)}
          className={cx(
            "min-h-11 rounded-xl border px-3.5 text-sm transition",
            value === v ? "border-accent bg-accent text-accent-ink font-semibold" : "border-border bg-bg-elev text-text hover:border-muted",
          )}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

function Chips({ value, onChange, options }: { value: string | null; onChange: (v: string | null) => void; options: [string, string][] }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map(([v, label]) => (
        <button
          key={v}
          type="button"
          aria-pressed={value === v}
          onClick={() => onChange(value === v ? null : v)}
          className={cx("min-h-10 rounded-full border px-3 text-sm transition", value === v ? "border-accent bg-accent text-accent-ink font-semibold" : "border-border bg-bg-elev text-muted hover:border-muted hover:text-text")}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
