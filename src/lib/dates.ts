import { z } from "zod";
import { MONTH_ONLY } from "@/lib/play/precision";

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

/**
 * The same input, widened by one shape: a bare `YYYY-MM`.
 *
 * This is what `src/lib/play/service.ts` accepts for a run's `startedAt` and
 * `endedAt` (GAMEEXPLOR-0037). `whenSchema` above is deliberately left alone —
 * the journal still uses it, and a journal entry happened on a *day*: it is
 * usually written the day it happened, and "by month" was a request about
 * runs.
 *
 * **The precision is carried by the shape of the value, not by a second
 * field.** `2026-08` means August; `2026-08-12` means the 12th. There is no
 * `precision` key in any request body and no `--precision` flag, so there is
 * no pair of fields that can disagree and nothing for a caller to forget — and
 * the widening cannot break an existing caller, because `2026-08` is refused
 * by the schema as it stands today, so nothing in the wild is sending one.
 *
 * Note what this schema does *not* do: it validates the shape and hands the
 * raw value on. `parsePrecise` in `src/lib/play/precision.ts` is what turns it
 * into a date and a precision, and the service calls it. Transforming here
 * instead would have changed the argument type of `startSession`,
 * `logPastSession` and `updateSession` from a date to a pair, for no gain —
 * every one of them already has to decide which of the two columns it is
 * writing.
 *
 * The month arm is `MONTH_ONLY` from `precision.ts` rather than a second
 * regex: `/^\d{4}-\d{2}$/` accepts `2026-13`, and `new Date(2026, 12, 1)`
 * rolls silently into January 2027 instead of throwing. One regex, one
 * refusal.
 */
export const preciseWhenSchema = z.union([
  z.string().datetime({ offset: true }),
  z.string().date(),
  z.string().regex(MONTH_ONLY, { error: "a month is YYYY-MM, with a month between 01 and 12" }),
  z.date(),
]);
