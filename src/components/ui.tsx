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

export function Badge({ tone = "muted", children, className }: { tone?: "muted" | "good" | "warn" | "bad" | "accent" | "info"; children: ReactNode; className?: string }) {
  const tones = {
    muted: "bg-surface-2 text-muted",
    good: "bg-good/15 text-good",
    warn: "bg-warn/15 text-warn",
    bad: "bg-bad/15 text-bad",
    accent: "bg-accent text-accent-ink",
    info: "bg-accent-2/15 text-accent-2",
  };
  return <span className={cx("inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium whitespace-nowrap", tones[tone], className)}>{children}</span>;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * `12 Aug 2026`, formatted off the machine's own clock rather than
 * `toLocaleDateString`, so a server render and the browser render that
 * hydrates it are byte-identical and React stays quiet.
 *
 * Here rather than in `src/lib/dates.ts` for two reasons: a helper exported
 * from a `"use client"` module is a client reference on the server (not a
 * function you can call), and `lib/dates` imports zod — which a client
 * component has no business dragging into its bundle. `lib/dates` still owns
 * the parsing half: a bare `YYYY-MM-DD` is local midnight, never UTC.
 */
export function day(d: Date | string): string {
  const x = new Date(d);
  return `${x.getDate()} ${MONTHS[x.getMonth()]} ${x.getFullYear()}`;
}

/** The local calendar day as `YYYY-MM-DD`: what a date input holds, and what `parseWhen` reads back as local midnight. */
export function dateInput(d: Date | string = new Date()): string {
  const x = new Date(d);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`;
}

/**
 * The message behind a failed API response, for the alert every write path
 * shows. The body is not always JSON — a 413 can come back as HTML, a dropped
 * connection as nothing at all — and a bare `res.json()` there replaces the
 * real failure with "Unexpected end of JSON input". Falls back to the status.
 */
export async function apiError(res: Response): Promise<Error> {
  const body = (await res.json().catch(() => null)) as { error?: string } | null;
  return new Error(body?.error || res.statusText || `HTTP ${res.status}`);
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
