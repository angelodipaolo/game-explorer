import { z } from "zod";

/**
 * Date handling for the things you enter by hand: when a run started, when a
 * memory happened.
 *
 * The trap this exists to close: `new Date("2026-08-30")` is UTC midnight, and
 * UTC midnight is the *previous day* everywhere west of Greenwich. A run you
 * backdated to "yesterday" on a phone in America/Los_Angeles would render as
 * the day before that — the kind of off-by-one you notice immediately and
 * cannot explain. A bare `YYYY-MM-DD` therefore means local midnight on that
 * calendar day, which is what someone picking a date on a phone means by it.
 *
 * A full timestamp is left alone: it already carries an offset, so there is
 * nothing to guess.
 */

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** `"2026-08-30"` → local midnight. A full ISO timestamp or a Date passes through. */
export function parseWhen(v: string | Date): Date {
  if (v instanceof Date) return v;
  const m = DATE_ONLY.exec(v.trim());
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : new Date(v);
}

/**
 * The shared input type for every user-entered instant: an ISO timestamp, a
 * bare calendar date, or a Date (the API sends strings, tests send Dates).
 */
export const whenSchema = z.union([z.string().datetime({ offset: true }), z.string().date(), z.date()]).transform(parseWhen);
