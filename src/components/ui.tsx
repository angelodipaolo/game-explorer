import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";

function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}
export { cx };

type Variant = "primary" | "secondary" | "ghost" | "danger";

const variantClass: Record<Variant, string> = {
  primary: "bg-accent text-accent-ink hover:brightness-110 active:brightness-95 font-semibold",
  secondary: "bg-surface-2 text-text border border-border hover:border-muted",
  ghost: "text-muted hover:text-text hover:bg-surface-2",
  danger: "bg-bad/15 text-bad border border-bad/30 hover:bg-bad/25",
};

const base = "inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm transition disabled:cursor-not-allowed disabled:opacity-40 min-h-11";

export function Button({ variant = "secondary", className, ...props }: ComponentProps<"button"> & { variant?: Variant }) {
  return <button className={cx(base, variantClass[variant], className)} {...props} />;
}

export function LinkButton({ variant = "secondary", className, ...props }: ComponentProps<typeof Link> & { variant?: Variant }) {
  return <Link className={cx(base, variantClass[variant], className)} {...props} />;
}

export function Badge({ tone = "muted", children, className, title }: { tone?: "muted" | "good" | "warn" | "bad" | "accent" | "info"; children: ReactNode; className?: string; title?: string }) {
  const tones = {
    muted: "bg-surface-2 text-muted",
    good: "bg-good/15 text-good",
    warn: "bg-warn/15 text-warn",
    bad: "bg-bad/15 text-bad",
    accent: "bg-accent text-accent-ink",
    info: "bg-accent-2/15 text-accent-2",
  };
  return (
    <span title={title} className={cx("inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium whitespace-nowrap", tones[tone], className)}>
      {children}
    </span>
  );
}

/**
 * The date vocabulary lives in `src/lib/play/format.ts` now and is re-exported
 * from here so that the dozens of existing `import { day } from
 * "@/components/ui"` call sites keep working.
 *
 * The move is GAMEEXPLOR-0037: a run's dates can be a month as well as a day,
 * which needs one `MONTHS` array and one set of rules, not a copy here and a
 * copy there. What has *not* changed is why these are not in
 * `src/lib/dates.ts`: that module imports zod, and a client component has no
 * business dragging a parser into its bundle to render "12 Aug 2026". A helper
 * exported from a `"use client"` module is also a client reference on the
 * server rather than a function the server can call, which is why the
 * definitions sit in a plain module and only pass through here.
 *
 * `lib/dates` still owns the parsing half, and `lib/play/precision` the
 * arithmetic: a bare `YYYY-MM-DD` is local midnight, never UTC, and a bare
 * `YYYY-MM` is the first instant of that month.
 */
export { day, shortDay, dateInput, monthInput } from "@/lib/play/format";

/**
 * The message behind a failed API response, for the alert every write path
 * shows. The body is not always JSON — a 413 can come back as HTML, a dropped
 * connection as nothing at all — and a bare `res.json()` there replaces the
 * real failure with "Unexpected end of JSON input". Falls back to the status.
 */
export async function apiError(res: Response): Promise<Error> {
  const body = (await res.json().catch(() => null)) as { error?: string; details?: unknown } | null;
  // A zod failure comes back as the constant "invalid input" with the sentence
  // a person can act on — "slug must be lower-case words joined by hyphens" —
  // buried in `details`. Showing only `error` turned every validation failure
  // into two useless words, which is worst on a form with several fields.
  return new Error([body?.error, detailMessages(body?.details)].filter(Boolean).join(" — ") || res.statusText || `HTTP ${res.status}`);
}

/** The messages out of a zod issue list, if that is what `details` holds. */
function detailMessages(details: unknown): string {
  if (!Array.isArray(details)) return "";
  return [...new Set(details.map((d) => (d && typeof d === "object" && "message" in d ? String((d as { message: unknown }).message) : "")).filter(Boolean))].join("; ");
}

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx("rounded-2xl border border-border bg-surface", className)}>{children}</div>;
}

export function PageTitle({ children, sub }: { children: ReactNode; sub?: ReactNode }) {
  return (
    <div className="mb-6">
      <h1 className="font-display text-2xl font-bold tracking-tight sm:text-3xl">{children}</h1>
      {sub ? <p className="mt-1 text-sm text-muted">{sub}</p> : null}
    </div>
  );
}

/**
 * The magnifier, as real geometry rather than the character `⌕` (U+2315).
 *
 * The glyph was legible enough inside a labelled field, where the placeholder
 * carries the meaning, but GAMEEXPLOR-0033 makes it the *entire* affordance of
 * two icon-only buttons — the header's phone toggle and the collapsed filter
 * search — and at 18px U+2315 renders as an ambiguous ring whose shape depends
 * on whichever font the platform substitutes. A path we draw ourselves is the
 * same mark on every device. `currentColor`, so each caller's contrast token
 * decides the weight.
 */
export function SearchIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" aria-hidden focusable="false" className={cx("h-[18px] w-[18px] shrink-0", className)}>
      <circle cx="8.75" cy="8.75" r="5.25" />
      <path d="M12.6 12.6 16.5 16.5" />
    </svg>
  );
}
