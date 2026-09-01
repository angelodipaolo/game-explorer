/**
 * How precisely a run's date was claimed — and the pure arithmetic that
 * follows from it (GAMEEXPLOR-0037).
 *
 * The rule this module exists to hold, and the only one worth memorising:
 *
 * > **A run's dates carry the precision they were claimed at. The app records
 * > what it was told, renders exactly that, and never rounds in either
 * > direction.**
 *
 * "August 2026" and "12 August 2026" are two different true sentences about
 * two different runs. Storing the first as `2026-08-01` and rendering it back
 * as "1 Aug 2026" would put a day in the owner's mouth that they never said —
 * the same confident guess this codebase refuses everywhere else (a co-op
 * *kind* is never inferred from a bare co-op signal; a filter's "unknown" is
 * never shown as a "no"). So the day is stored, because storing more than you
 * display is free, and a marker travels beside it saying the day is
 * scaffolding.
 *
 * **The precision is carried by the shape of the value, never by a second
 * field**: `2026-08` is a month, `2026-08-12` is a day. There is no
 * `--precision` flag and no `startedPrecision` in any request body. That is
 * the nicest property of the model — there is no pair of fields that can
 * contradict each other, and no field an agent can forget. It is also why the
 * widening was safe to ship: `2026-08` is *rejected* by today's schema, so
 * nothing in the wild can already be sending one.
 *
 * ## Why this file imports nothing, and lives next to the formatter
 *
 * Both halves of the app need it. `src/lib/play/service.ts` needs `endOf` to
 * decide whether a run ends before it starts; `play-history.tsx` — a client
 * component — needs the same function to grey out the Save button before the
 * round trip, and `format.ts` needs `startOf` to collapse "Aug 2026 — Aug
 * 2026" into the claim actually made. Putting it in `src/lib/dates.ts` would
 * drag zod into a browser bundle for the sake of two comparisons; that is
 * exactly the reason `day()` lives in `components/ui.tsx` today rather than
 * beside `parseWhen`. `src/lib/dates.ts` imports *this*, not the other way
 * round: zod on top of arithmetic, never underneath it.
 *
 * ## Adding a rung later ("year", "decade")
 *
 * Deferred, not designed out — the owner's "a bunch in the nineties" is a
 * *decade* and several runs, so a `year` rung would not have captured it
 * either and `undated` plus a note stays its honest home. But the day someone
 * does want one, the whole cost is meant to be: add it to `PRECISIONS`, add a
 * `{ regex, precision }` row to `SHAPES`, and let TypeScript's exhaustiveness
 * checking on `startOf`/`endOf` walk you to every other site that has to
 * decide something. That is why those two are `switch`es over the union with a
 * `never` fallthrough rather than `if (p === "month")` — an `if` would quietly
 * treat a new rung as a day and be right nowhere.
 */

/** Every precision a date can be claimed at, coarsest last. */
export const PRECISIONS = ["day", "month"] as const;
export type Precision = (typeof PRECISIONS)[number];

/** A date and the precision it was claimed at — what the columns store together. */
export type Precise = { at: Date; precision: Precision };

/**
 * The shapes a bare date can arrive in, most precise first, as data rather
 * than an if-chain so a new rung is one row.
 *
 * The month arm is constrained to `01`–`12` on purpose. The obvious
 * `/^(\d{4})-(\d{2})$/` also matches `2026-13`, and `new Date(2026, 12, 1)`
 * does not throw — it rolls silently into January 2027, so a typo becomes a
 * confidently wrong date five months away. Today that string is refused by
 * `z.string().date()`; the new branch has to refuse it just as firmly rather
 * than inherit the refusal.
 *
 * The day arm is *not* strict about the day-of-month (`\d{2}`), which mirrors
 * `parseWhen` exactly: anything that reaches here has already passed
 * `z.string().date()`, and diverging from `parseWhen` on impossible dates
 * would mean two parsers with two answers for `2026-02-31`.
 */
export const MONTH_ONLY = /^(\d{4})-(0[1-9]|1[0-2])$/;
const DAY_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

const SHAPES: { regex: RegExp; precision: Precision }[] = [
  { regex: DAY_ONLY, precision: "day" },
  { regex: MONTH_ONLY, precision: "month" },
];

/** True for a string that is one of the precisions this app knows. */
export function isPrecision(v: unknown): v is Precision {
  return typeof v === "string" && (PRECISIONS as readonly string[]).includes(v);
}

/**
 * A precision read back out of the database. The column is a `String` —
 * SQLite has no enums and this codebase does not pretend otherwise (see
 * `outcome`) — so a row written by hand, or by an older build, can hold
 * anything. Falling back to `"day"` is the safe direction: it renders the
 * value that is actually stored, which is never a lie, only sometimes more
 * detail than was claimed.
 */
export function storedPrecision(v: string): Precision {
  return isPrecision(v) ? v : "day";
}

/**
 * `"2026-08"` → the first instant of August, local time, at month precision.
 * `"2026-08-12"` → local midnight on the 12th, at day precision. Anything
 * else — a full ISO timestamp, a `Date` — is a day: it names an instant, and
 * an instant is as precise as this app gets.
 *
 * Local, not UTC, for the reason `src/lib/dates.ts` spells out at length:
 * `new Date("2026-08-01")` is UTC midnight, which is *July* everywhere west of
 * Greenwich, and a month backdated on a phone in Los Angeles would render as
 * the month before.
 *
 * The stored value is always the **first** instant of the claimed period, never
 * the last. Storing a month-precision *end* as 31 August 23:59 would put
 * `lastPlayedAt` in the future for a run finished "this month", which is a
 * stranger bug than the ordering imprecision it would fix. The cost is that a
 * run ended "Aug 2026" sorts as though it ended on the 1st, so a day-precision
 * run ended 15 Aug outranks it in "recently played". That is acceptable: the
 * two claims are genuinely not comparable, and `lastPlayedAt` drives a sort
 * order and one caption, not a decision.
 */
export function parsePrecise(v: string | Date): Precise {
  if (v instanceof Date) return { at: v, precision: "day" };
  const s = v.trim();
  for (const { regex, precision } of SHAPES) {
    const m = regex.exec(s);
    if (!m) continue;
    return { at: new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3] || 1)), precision };
  }
  return { at: new Date(s), precision: "day" };
}

/**
 * The first instant of the period this date falls in — local midnight of the
 * day, or of the 1st of the month.
 *
 * Note that this is a *comparison* helper, not a normaliser: nothing writes
 * its output back to a column. A day-precision run started from a full ISO
 * timestamp keeps its 14:00 in the database; it merely counts as having begun
 * that day when something asks whether it begins before another period ends.
 */
export function startOf(at: Date, p: Precision): Date {
  switch (p) {
    case "day":
      return new Date(at.getFullYear(), at.getMonth(), at.getDate());
    case "month":
      return new Date(at.getFullYear(), at.getMonth(), 1);
  }
  // Unreachable while `p` is a Precision — and a compile error the moment a
  // rung is added without a case here, which is the whole point.
  return exhausted(p);
}

/**
 * The last instant of the period this date falls in. This is the half that
 * does real work: a run whose end was claimed as "Aug 2026" ended *somewhere*
 * in August, so it is only out of order if the whole of August is before the
 * start.
 */
export function endOf(at: Date, p: Precision): Date {
  switch (p) {
    case "day":
      return new Date(at.getFullYear(), at.getMonth(), at.getDate(), 23, 59, 59, 999);
    case "month":
      return new Date(at.getFullYear(), at.getMonth() + 1, 0, 23, 59, 59, 999);
  }
  return exhausted(p);
}

/** Two instants that name the same period at this precision. */
export function samePeriod(a: Date, b: Date, p: Precision): boolean {
  return startOf(a, p).getTime() === startOf(b, p).getTime();
}

/**
 * A run is out of order only when its end period finishes before its start
 * period begins — not when the two stored instants compare backwards.
 *
 * This is precision-aware because it has to be, and it repairs a live bug on
 * the way. Two cases it now accepts that the naive comparison refused:
 *
 * - **Started 12 Aug 2026 (day), finished "Aug 2026" (month).** The end is
 *   stored as 1 August, so `endedAt < startedAt` — a 400 on a perfectly
 *   ordinary run. Month precision would have made this an everyday failure.
 * - **Started at 14:00 today, finished "today" (a bare date, so local
 *   midnight).** Today's code refuses a run finished the day it started, which
 *   is the single most common run there is. That refusal was never intended;
 *   it is a stated behaviour change, not a side effect.
 *
 * Still refused, and this is the case the check exists for: started 12 Aug,
 * finished "Jul 2026". No reading of July overlaps 12 August.
 */
export function outOfOrder(startedAt: Date, sp: Precision, endedAt: Date, ep: Precision): boolean {
  return endOf(endedAt, ep).getTime() < startOf(startedAt, sp).getTime();
}

/** The compile-time guard behind every `switch` above. */
function exhausted(p: never): never {
  throw new Error(`unhandled precision: ${String(p)}`);
}
