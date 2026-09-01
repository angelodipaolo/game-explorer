import { type Precision, samePeriod, storedPrecision } from "./precision";

/**
 * **The one place a run's dates become words.** Nothing else in the app may
 * spell a run's date string by hand.
 *
 * This is the same invariant `src/lib/players.ts` holds for player labelling,
 * and it is here for the same reason it is there. Before GAMEEXPLOR-0037,
 * `day(s.startedAt)` was written out in six places — the play-history row and
 * its aria-label, the open-run banner, the journal's "on this run" chip, the
 * journal's run headings, and `/playing`'s two captions. They agreed only
 * because they were all trivial. The moment one of them learns that a date can
 * be a month and another does not, the same run reads "Aug 2026" in the play
 * history and "1 Aug 2026" two sections down, and nobody can tell which one is
 * the truth.
 *
 * ## Why this file imports nothing but `./precision`
 *
 * Every caller is a client component. `src/lib/dates.ts` imports zod, and a
 * formatter that dragged zod into the browser bundle to render "12 Aug 2026"
 * would be paying a parser's weight for a string join — which is exactly why
 * `day()` was living in `components/ui.tsx` in the first place (see the
 * docstring there). `components/ui.tsx` now re-exports `day`/`shortDay` from
 * here so there is one `MONTHS` array in the codebase rather than two.
 *
 * ## Why the dates are formatted by hand
 *
 * `toLocaleDateString` is not stable between a Node render and the browser
 * render that hydrates it — different ICU data, different default locale — and
 * the mismatch surfaces as a hydration warning on a page that is otherwise
 * fine. Reading `getDate()`/`getMonth()`/`getFullYear()` off the Date and
 * joining them is byte-identical on both sides.
 */

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * The subset of a `PlaySession` this module reads. Structural rather than
 * `Pick<PlaySession, …>` so that `/playing`'s `InProgressRow` — a view model
 * that carries an open run's start and nothing else — can be handed straight
 * to `runSince` without inventing the four fields it does not have.
 */
export type RunLike = {
  startedAt: Date | string;
  startedPrecision: string;
  endedAt?: Date | string | null;
  endedPrecision?: string;
  undated?: boolean;
};

/** What an undated run's dates say, everywhere. Its timestamps are the day it was typed in. */
export const UNDATED_DATES = "Date unknown";

/**
 * The open end of a run, in the play history and the journal's run headings.
 * The wording is `journal.tsx`'s own ("playing now" → "now") rather than a
 * second phrase for the same state.
 */
const NOW = "now";

/** `12 Aug 2026`. */
export function day(d: Date | string): string {
  const x = new Date(d);
  return `${x.getDate()} ${MONTHS[x.getMonth()]} ${x.getFullYear()}`;
}

/**
 * `12 Aug`, or `12 Aug 2025` once the year stops being obvious — for a caption
 * too narrow to spend four characters on this year (home's three-across card).
 *
 * Built from the same parts as `day` rather than by trimming its output: a
 * regex over a formatted date silently stops matching the day the format
 * changes, and quietly renders the year again.
 */
export function shortDay(d: Date | string): string {
  const x = new Date(d);
  const dm = `${x.getDate()} ${MONTHS[x.getMonth()]}`;
  return x.getFullYear() === new Date().getFullYear() ? dm : `${dm} ${x.getFullYear()}`;
}

/** `Aug 2026` — a month-precision date, with the stored day left where it belongs. */
export function month(d: Date | string): string {
  const x = new Date(d);
  return `${MONTHS[x.getMonth()]} ${x.getFullYear()}`;
}

/** `Aug`, or `Aug 2025` off this year — `shortDay`'s rule, one rung coarser. */
export function shortMonth(d: Date | string): string {
  const x = new Date(d);
  return x.getFullYear() === new Date().getFullYear() ? MONTHS[x.getMonth()] : month(x);
}

/**
 * One end of a run, rendered at exactly the precision it was claimed at. The
 * single rule of this module in one function: never show a day that was not
 * recorded, never hide a day that was.
 */
export function stamp(d: Date | string, p: Precision): string {
  return p === "month" ? month(d) : day(d);
}

/** The same, for a caption with no room (home's compact card). */
function shortStamp(d: Date | string, p: Precision): string {
  return p === "month" ? shortMonth(d) : shortDay(d);
}

/**
 * A whole run's dates as one phrase — for the play-history row and the
 * journal's run headings.
 *
 * ```
 * 12 Aug 2026 — 14 Sep 2026   day → day
 * Aug 2026                    month → month, one month  (not "Aug 2026 — Aug 2026")
 * Aug — Oct 2026              month → month, one year
 * Nov 2025 — Feb 2026         month → month, across years
 * 12 Aug 2026 — Oct 2026      day → month
 * Aug 2026 — 3 Oct 2026       month → day
 * Aug 2026 — now              still open
 * Date unknown                undated
 * ```
 *
 * The one-month collapse is not cosmetic. "Aug 2026 — Aug 2026" reads as a
 * range whose two ends happen to coincide; "Aug 2026" reads as the claim that
 * was actually made, and a run that started and finished inside one month is
 * the most common past run there is. Day precision is deliberately *not*
 * collapsed the same way — "30 Aug 2026 — 30 Aug 2026" is what the app has
 * always rendered for a one-day run, and narrowing that here would be an
 * unrelated change riding along.
 */
export function runDates(s: RunLike): string {
  if (s.undated) return UNDATED_DATES;
  const sp = storedPrecision(s.startedPrecision);
  const start = stamp(s.startedAt, sp);
  if (!s.endedAt) return `${start} — ${NOW}`;

  const ep = storedPrecision(s.endedPrecision ?? "day");
  if (sp === "month" && ep === "month") {
    const a = new Date(s.startedAt);
    const b = new Date(s.endedAt);
    if (samePeriod(a, b, "month")) return start;
    // "Aug — Oct 2026": one year is stated once. Across years both are needed,
    // which is the fall-through below.
    if (a.getFullYear() === b.getFullYear()) return `${MONTHS[a.getMonth()]} — ${month(b)}`;
  }
  return `${start} — ${stamp(s.endedAt, ep)}`;
}

/**
 * When a run began, for the "Playing since …" banner and `/playing`'s caption.
 * Only the start is read, so an open run's view model needs to carry nothing
 * else.
 */
export function runSince(s: Pick<RunLike, "startedAt" | "startedPrecision">): string {
  return stamp(s.startedAt, storedPrecision(s.startedPrecision));
}

/** `runSince` for home's three-across card, ~105px wide: this year's year is dropped. */
export function runSinceShort(s: Pick<RunLike, "startedAt" | "startedPrecision">): string {
  return shortStamp(s.startedAt, storedPrecision(s.startedPrecision));
}

/** The local calendar day as `YYYY-MM-DD`: what `<input type="date">` holds, read back as local midnight. */
export function dateInput(d: Date | string = new Date()): string {
  const x = new Date(d);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`;
}

/** The local month as `YYYY-MM`: what `<input type="month">` holds, and what the API reads as a month claim. */
export function monthInput(d: Date | string = new Date()): string {
  const x = new Date(d);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}`;
}
