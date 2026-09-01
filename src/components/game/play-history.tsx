"use client";

import { useRouter } from "next/navigation";
import { useState, useSyncExternalStore } from "react";
import type { PlaySession } from "@prisma/client";
import { apiError, cx, dateInput, monthInput } from "@/components/ui";
import { Section, openSection } from "@/components/game/section";
import { runDates } from "@/lib/play/format";
import { outOfOrder, parsePrecise, storedPrecision } from "@/lib/play/precision";

/**
 * Every run for one owned copy: the log this game's play state is derived
 * from. There is no status column anywhere behind this — an open run is a row
 * with no `endedAt`, and that is the only definition of "playing now".
 *
 * The start/finish buttons live in `play-controls.tsx`, in the header block
 * above the fold — this component keeps the list, its edit toggle, and the
 * add-a-run form. Both stay client components hitting the same endpoints and
 * calling `router.refresh()`; there is no shared state to thread, the server
 * refresh reconciles them.
 *
 * The inline-editor pattern from TagEditor: read-only until you toggle Edit,
 * every write goes through the API and ends in `router.refresh()`, and every
 * control is a 44px tap target because the whole point is tapping "Finished"
 * on the couch with a controller in the other hand.
 *
 * ## The open run is a row here too (GAMEEXPLOR-0037)
 *
 * It did not used to be: the list was `sessions.filter(s => s.endedAt)` while
 * the heading counted `sessions.length`, so a copy with a run in progress
 * rendered "Play history · 3" over two rows. Worse, an open run's dates could
 * not be edited anywhere in the UI at all — only through `PATCH
 * /api/sessions/:id` — which made "let me set when I actually started this"
 * impossible for the run it most often applies to.
 *
 * The row is **read-and-edit only**. Finished / Gave up / Undo stay above the
 * fold where GAMEEXPLOR-0023 put them on purpose; a second copy of the primary
 * action two thousand pixels down is how two buttons for one thing start
 * disagreeing about which is enabled.
 */

const OUTCOME_LABEL: Record<string, string> = { playing: "Playing", completed: "Finished it", abandoned: "Gave up" };

export function PlayHistory({ gameId, sessions, canEdit }: { gameId: string; sessions: PlaySession[]; canEdit: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [pastOpen, setPastOpen] = useState(false);

  const open = sessions.find((s) => !s.endedAt) ?? null;
  // The open run sorts first, and that sort lives **here rather than in
  // `sessionsFor`**. That query is the agent-facing contract behind `GET
  // /api/games/:id/sessions` and `gx play list`, and its documented order
  // ("newest first, undated last") must not shift under agents for a UI
  // reason. It matters more than it sounds now that a run can be backdated: an
  // open run started in 2019 would otherwise sort below a closed run from 2024
  // and read as history rather than as what you are playing.
  const rows = open ? [open, ...sessions.filter((s) => s.endedAt)] : sessions;

  async function call(method: "POST" | "PATCH" | "DELETE", url: string, body?: object) {
    setBusy(true);
    try {
      const res = await fetch(url, { method, headers: { "content-type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) });
      if (!res.ok) throw await apiError(res);
      setEditId(null);
      setPastOpen(false);
      router.refresh();
      return true;
    } catch (e) {
      alert((e as Error).message);
      router.refresh();
      return false;
    } finally {
      setBusy(false);
    }
  }

  const editButton =
    rows.length && canEdit ? (
      <button onClick={() => setEditing((e) => !e)} className="tap-44 min-h-8 rounded-full border border-border px-3 text-xs text-muted hover:border-muted hover:text-text" data-testid="edit-runs">
        {editing ? "Done" : "Edit"}
      </button>
    ) : null;

  // Nothing to read here yet — the CTA lives above the fold now — so this
  // stays a quiet closed row, the add affordance in the header instead of an
  // open drawer of onboarding copy (GAMEEXPLOR-0023 round 2, item E).
  const emptyAddButton =
    !rows.length && canEdit ? (
      <button
        onClick={() => {
          openSection("play");
          setPastOpen(true);
        }}
        className="tap-44 min-h-8 rounded-full border border-border px-3 text-xs text-muted hover:border-muted hover:text-text"
        data-testid="add-past-run-empty"
      >
        + Add a run
      </button>
    ) : null;

  return (
    <Section id="play" title="Play history" count={sessions.length} testId="play-history" collapsible defaultOpen={rows.length > 0} storageKey="play" action={editButton} emptyAction={emptyAddButton} className="max-w-3xl">
      {rows.length ? (
        <ul className="flex flex-col gap-2">
          {rows.map((s) =>
            editId === s.id ? (
              <li key={s.id}>
                <RunForm
                  initial={s}
                  busy={busy}
                  onCancel={() => setEditId(null)}
                  onSubmit={(body) => call("PATCH", `/api/sessions/${s.id}`, body)}
                  // "Still playing it" needs a start to resume from, and an
                  // undated run's is the day it was typed in. The service
                  // refuses it too; this keeps the button off the screen. An
                  // already-open run has nothing to reopen.
                  onReopen={s.undated || !s.endedAt ? undefined : () => call("PATCH", `/api/sessions/${s.id}`, { endedAt: null })}
                  // Undoing an open run is the "Undo" button above the fold,
                  // beside the Finished it duplicates. One delete, one place.
                  onDelete={s.endedAt ? () => confirm("Delete this run? Anything written during it stays in the journal.") && call("DELETE", `/api/sessions/${s.id}`) : undefined}
                />
              </li>
            ) : (
              <li key={s.id} className={cx("flex items-start justify-between gap-3 rounded-xl border p-3", s.endedAt ? "border-border bg-surface" : "border-accent/40 bg-accent/5")} data-testid="run-row">
                <div className="min-w-0">
                  <div className="text-sm font-medium">
                    {/* An undated run's timestamps are the day it was typed in, so
                        they are never shown — "at some point" is the whole claim. */}
                    {s.undated ? (
                      <span className="text-muted" data-testid="run-undated">
                        Played · date unknown
                      </span>
                    ) : (
                      // Never spelled here: `runDates` is the one place a run's
                      // dates become words, so a month-precision run reads
                      // "Aug 2026" in this row, in the banner above and in the
                      // journal's run headings below, and never "1 Aug 2026".
                      <span data-testid="run-dates">{runDates(s)}</span>
                    )}
                    <span className={cx("ml-2 text-xs", s.outcome === "completed" ? "text-good" : s.outcome === "playing" ? "text-accent" : "text-muted")}>{OUTCOME_LABEL[s.outcome] ?? s.outcome}</span>
                  </div>
                  {s.note ? <p className="mt-1 whitespace-pre-wrap text-sm text-muted">{s.note}</p> : null}
                </div>
                {editing && canEdit ? (
                  <button onClick={() => setEditId(s.id)} disabled={busy} className="min-h-11 shrink-0 rounded-lg border border-border px-3 text-xs text-muted hover:border-muted hover:text-text" aria-label={s.undated ? "Edit the run with no dates" : `Edit the run from ${runDates(s)}`}>
                    Edit
                  </button>
                ) : null}
              </li>
            ),
          )}
        </ul>
      ) : null}

      {canEdit ? (
        <div className="mt-3">
          {pastOpen ? (
            // `canStartRun` is what hides the "Still playing" option when this
            // copy already has one open: the only possible outcome of choosing
            // it would be the 409 the service returns, and an option that can
            // only fail is not an option. The 409 stays as the backstop for
            // the second-tab case, where this component's `sessions` are stale.
            <RunForm past canStartRun={!open} busy={busy} onCancel={() => setPastOpen(false)} onSubmit={(body) => call("POST", `/api/games/${gameId}/sessions`, body)} />
          ) : (
            <button onClick={() => setPastOpen(true)} className="min-h-11 rounded-xl border border-dashed border-border px-4 text-sm text-muted hover:border-muted hover:text-text" data-testid="add-past-run">
              + Add a run
            </button>
          )}
        </div>
      ) : null}
      {!sessions.length && !pastOpen ? <p className="mt-2 text-xs text-faint">Runs at this copy. Finishing one keeps its dates and its journal, so a replay in three years is its own run.</p> : null}
    </Section>
  );
}

/**
 * What the form posts. Three shapes, not two, and the third is the feature:
 * a run with a start, a note and **no `endedAt` key at all** is what `POST
 * /api/games/:id/sessions` reads as "open a run from this date" — it falls
 * past the `if (body.endedAt || body.undated)` branch into `startSession`,
 * which backdates the run and drops the copy out of the queue in the same
 * transaction. The server has been able to do this since the day it was
 * written; the UI simply never offered it.
 *
 * `endedAt` is **absent**, never `""`. An empty string fails the schema rather
 * than falling through, and `endedAt: null` on a POST would mean something
 * else again.
 */
type RunBody =
  | { startedAt: string; endedAt: string; undated: false; outcome: string; note: string | null }
  | { startedAt: string; undated: false; outcome: "playing"; note: string | null }
  | { undated: true; outcome: string; note: string | null };

/** What the two date fields are asking for. A month is the default; a day is one tap away. */
type Grain = "month" | "day";

/**
 * One run's dates, outcome and note — the add form, and the inline editor
 * behind Edit on any row including the open one.
 *
 * ## Months, and why they are the default (GAMEEXPLOR-0037)
 *
 * The cost of day precision was never the picker, it was the *question*. Being
 * asked "which day?" about a run you played last spring is a moment where you
 * cannot answer, so you either stall or invent — and that moment is why runs
 * go unrecorded or get recorded wrong. So the form asks for the precision a
 * person actually has and never for more: a month by default, a day behind one
 * tap for the run you do remember, and the checkbox for the run whose year is
 * gone.
 *
 * The precision travels in the *shape of the value* — `2026-08` is a month,
 * `2026-08-12` is a day — so there is no second field here that could
 * contradict the first, and nothing extra for the API to accept.
 *
 * ## One granularity for both fields, and which way it rounds
 *
 * The model keeps the two precisions independent (a run really can start on
 * the 12th and end "sometime in October" — the Finished button produces
 * exactly that against a backdated start), but one toggle for one form is the
 * right interface. When the two disagree, the form opens at the **coarser** of
 * them: showing a month-precision date in a day field would seed it as the
 * 1st, and one tap on Save would then enshrine a day the owner never said.
 * Coarsening is recoverable — "by day instead" is right there — and inventing
 * is not.
 *
 * ## The undated run
 *
 * A run you know you played but cannot place is the common case for anything
 * you owned as a child, so the dates come off entirely rather than being
 * guessed: ticking the box drops the inputs out of the form and sends
 * `undated: true` with no dates at all. It is now the third rung of a ladder —
 * day, month, nothing — rather than the only alternative to a day, so it is
 * reworded to say what is missing is the *year*.
 */
function RunForm({
  initial,
  past,
  canStartRun = true,
  busy,
  onCancel,
  onSubmit,
  onReopen,
  onDelete,
}: {
  initial?: PlaySession;
  past?: boolean;
  canStartRun?: boolean;
  busy: boolean;
  onCancel: () => void;
  onSubmit: (body: RunBody) => Promise<boolean>;
  onReopen?: () => void;
  onDelete?: () => void;
}) {
  // Editing the run that is currently open. Its end date is not a field —
  // there is no end — and its outcome is not a choice, so neither renders.
  // Getting this wrong is a 400 rather than a silent no-op since
  // GAMEEXPLOR-0038: a patch carrying `outcome: "completed"` with no `endedAt`
  // is refused by name, and the old form seeded exactly that.
  const openRun = !!initial && !initial.endedAt;
  const [grain, setGrain] = useState<Grain>(() => grainOf(initial));
  // An undated run's stored timestamps are the afternoon it was typed in, so
  // seeding the inputs from them would hand that back as the answer and let one
  // tap on Save enshrine it — exactly the corruption the flag exists to prevent.
  // Empty instead; the inputs are `required`, so the form asks for real dates
  // before it will submit. A brand new run still defaults to the current month.
  const [startedAt, setStartedAt] = useState(() => (initial ? (initial.undated ? "" : atGrain(initial.startedAt, grainOf(initial))) : atGrain(new Date(), "month")));
  const [endedAt, setEndedAt] = useState(() => (initial ? (initial.undated || !initial.endedAt ? "" : atGrain(initial.endedAt, grainOf(initial))) : atGrain(new Date(), "month")));
  const [undated, setUndated] = useState(initial?.undated ?? false);
  const [outcome, setOutcome] = useState(() => (openRun ? "playing" : initial && initial.outcome !== "playing" ? initial.outcome : "completed"));
  const [note, setNote] = useState(initial?.note ?? "");
  // Which month control this engine can actually draw. Through
  // `useSyncExternalStore` rather than `useState` + an effect because the
  // answer is a property of the browser, not state this component owns: the
  // server has no `document` and must render *something*, and this is the one
  // hook that is allowed to give the two renders different answers without it
  // being a hydration error. (In practice the form only ever mounts after a
  // click, so the server never renders it — but that is a fact about today's
  // `pastOpen`/`editId`, not a contract, and it should not be what keeps this
  // correct.)
  const nativeMonth = useSyncExternalStore(neverChanges, supportsMonthInput, notOnTheServer);

  // "Still playing" is the third outcome, and it is what makes this form the
  // whole feature: it removes the end date and posts a run that is open from
  // the stated date. It is offered only where it can succeed — never on a copy
  // that already has a run in progress, and never when editing a closed run,
  // which has "Still playing it" as its own button below.
  const stillPlaying = outcome === "playing";
  const wantsEnd = !undated && !stillPlaying;
  const field = "min-h-11 w-full rounded-lg border border-border bg-bg px-3 text-base outline-none focus:border-accent";

  // The client's copy of the server's rule, so the round trip is spent on
  // races rather than on typos. Same helper the service calls, so the two
  // cannot drift into disagreeing about whether "12 Aug 2026 — Aug 2026" is a
  // valid run (it is: the end period has not finished when the start begins).
  const inverted = wantsEnd && !!startedAt && !!endedAt && invertedRange(startedAt, endedAt);

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void onSubmit(
          undated
            ? { undated: true, outcome, note: note.trim() || null }
            : stillPlaying
              ? { startedAt, undated: false, outcome: "playing", note: note.trim() || null }
              : { startedAt, endedAt, undated: false, outcome, note: note.trim() || null },
        );
      }}
      className="rounded-xl border border-border bg-bg-elev p-3"
      data-testid="run-form"
    >
      <div className="grid gap-2 sm:grid-cols-3">
        {/* An open run cannot be undated — its timestamps would be placeholders
            with nothing to resume from — and ticking this would silently close
            it. Not a choice worth offering on the row you opened to fix a date. */}
        {openRun ? null : (
          <label className="flex min-h-11 items-center gap-2 text-sm text-muted sm:col-span-3">
            <input
              type="checkbox"
              checked={undated}
              // Ticking this on a run that has real dates overwrites them with
              // placeholders and there is no undo, so it asks first — the same
              // stance as Delete right beside it.
              onChange={(e) => {
                if (e.target.checked && initial && !initial.undated && !confirm("Forget this run's dates? They cannot be recovered.")) return;
                // "I don't know when" and "still playing" are contradictory:
                // an open run's start is the moment you resume from, so a run
                // with no dates can never be one.
                if (e.target.checked && outcome === "playing") setOutcome("completed");
                setUndated(e.target.checked);
              }}
              className="h-5 w-5 accent-accent"
              data-testid="run-undated-toggle"
            />
            I don’t know when this was
          </label>
        )}
        {/* Not merely disabled and not merely hidden: an unsubmitted `required`
            input that is off-screen blocks the form with no visible error, and
            neither the dates (when the box is ticked) nor the end date (when
            the run is still going) is part of this run at all. Removed from the
            DOM is the only correct state. */}
        {undated ? null : (
          <>
            <label className="text-xs text-muted">
              Started
              <DateField grain={grain} native={nativeMonth} value={startedAt} onChange={setStartedAt} label="Started" testId="run-started" className={cx(field, "mt-1")} />
            </label>
            {wantsEnd ? (
              <label className="text-xs text-muted">
                Finished
                <DateField grain={grain} native={nativeMonth} value={endedAt} onChange={setEndedAt} label="Finished" testId="run-ended" className={cx(field, "mt-1")} />
              </label>
            ) : null}
          </>
        )}
        <label className="text-xs text-muted">
          How it went
          <select value={outcome} onChange={(e) => setOutcome(e.target.value)} className={cx(field, "mt-1")} aria-label="How it went" data-testid="run-outcome">
            <option value="completed">Finished it</option>
            <option value="abandoned">Gave up</option>
            {/* Odd English, honest model: open-ness really is one of a run's
                three outcomes, and the alternative — a separate checkbox that
                hides the end date — reads better and models worse. */}
            {!undated && (openRun || (past && canStartRun)) ? <option value="playing">Still playing</option> : null}
          </select>
        </label>
        {undated ? null : (
          <div className="sm:col-span-3">
            <button
              type="button"
              onClick={() => {
                const next: Grain = grain === "month" ? "day" : "month";
                setGrain(next);
                // Coarsening keeps the value (a day is inside its month).
                // Refining cannot: turning "2026-08" into "2026-08-01" would
                // put the 1st in front of someone who just said they know the
                // day, one tap from saving it. `required` makes them pick.
                setStartedAt((v) => (next === "month" ? v.slice(0, 7) : ""));
                setEndedAt((v) => (next === "month" ? v.slice(0, 7) : ""));
              }}
              className="tap-44 min-h-8 rounded-full border border-dashed border-border px-3 text-xs text-muted hover:border-muted hover:text-text"
              data-testid="run-grain"
            >
              {grain === "month" ? "by day instead" : "by month instead"}
            </button>
          </div>
        )}
        <label className="text-xs text-muted sm:col-span-3">
          Note
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Second playthrough, hard mode" className={cx(field, "mt-1")} aria-label="Run note" data-testid="run-note" />
        </label>
      </div>
      {inverted ? (
        <p className="mt-2 text-xs text-bad" data-testid="run-inverted">
          That run ends before it starts.
        </p>
      ) : null}
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button type="submit" disabled={busy || inverted} className="min-h-11 rounded-lg bg-accent px-4 text-sm font-semibold text-accent-ink disabled:opacity-40" data-testid="save-run">
          {past ? "Add run" : "Save"}
        </button>
        <button type="button" onClick={onCancel} disabled={busy} className="min-h-11 rounded-lg border border-border px-4 text-sm text-muted hover:border-muted hover:text-text">
          Cancel
        </button>
        {onReopen ? (
          <button type="button" onClick={onReopen} disabled={busy} className="min-h-11 rounded-lg border border-border px-4 text-sm text-muted hover:border-muted hover:text-text" data-testid="reopen-run">
            Still playing it
          </button>
        ) : null}
        {onDelete ? (
          <button type="button" onClick={onDelete} disabled={busy} className="ml-auto min-h-11 rounded-lg border border-bad/30 bg-bad/10 px-4 text-sm text-bad hover:bg-bad/20" data-testid="delete-run">
            Delete
          </button>
        ) : null}
      </div>
    </form>
  );
}

/**
 * `<input type="month">` where the browser has one, and a paired month/year
 * `<select>` where it does not.
 *
 * The fallback is not hypothetical caution. Desktop Safari has historically
 * degraded `type="month"` to a bare text box — no picker, no validation, and a
 * free-text field where "Aug 2026" typed by hand is silently not a value the
 * API will take. That would make this form worse than the two date inputs it
 * replaces, on the one browser the owner actually reads the app in. Feature
 * detection is the only honest test: set a value the control would reject as
 * text and see whether it survives.
 *
 * The `<select>` pair is not a consolation prize either — two taps, fully
 * controlled, identical on every engine, and arguably nicer one-handed than a
 * native wheel.
 */
function DateField({ grain, native, value, onChange, label, testId, className }: { grain: Grain; native: boolean; value: string; onChange: (v: string) => void; label: string; testId: string; className: string }) {
  if (grain === "day") return <input type="date" value={value} onChange={(e) => onChange(e.target.value)} required className={className} aria-label={label} data-testid={testId} />;
  if (native) return <input type="month" value={value} onChange={(e) => onChange(e.target.value)} required className={className} aria-label={label} data-testid={testId} />;

  const [year, mon] = value ? value.split("-") : ["", ""];
  const thisYear = new Date().getFullYear();
  // Far enough back for anything on this shelf — the oldest thing in the
  // collection is a 1983 cartridge — and one year forward for nothing at all,
  // because a run in the future is not a thing to record.
  const years = Array.from({ length: thisYear - 1979 }, (_, i) => thisYear - i);
  const set = (y: string, m: string) => onChange(y && m ? `${y}-${m}` : "");
  const sel = "min-h-11 rounded-lg border border-border bg-bg px-2 text-base outline-none focus:border-accent";
  return (
    <span className={cx(className, "flex gap-2 border-0 bg-transparent px-0")}>
      <select value={mon ?? ""} onChange={(e) => set(year ?? "", e.target.value)} required className={cx(sel, "min-w-0 flex-1")} aria-label={`${label} month`} data-testid={`${testId}-month`}>
        <option value="">Month</option>
        {MONTH_OPTIONS.map((name, i) => (
          <option key={name} value={String(i + 1).padStart(2, "0")}>
            {name}
          </option>
        ))}
      </select>
      <select value={year ?? ""} onChange={(e) => set(e.target.value, mon ?? "")} required className={cx(sel, "min-w-0 flex-1")} aria-label={`${label} year`} data-testid={`${testId}-year`}>
        <option value="">Year</option>
        {years.map((y) => (
          <option key={y} value={String(y)}>
            {y}
          </option>
        ))}
      </select>
    </span>
  );
}

/**
 * Three letters, not full names: two selects share the width of one field, and
 * "September" is clipped to "Septembe" in a 130px control on a 1440px screen —
 * let alone at 390. These are also the same abbreviations the app renders
 * dates with ("Aug 2026"), so the option you pick reads back as the words you
 * picked.
 */
const MONTH_OPTIONS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

let monthSupport: boolean | null = null;

/** A store that never emits: browser support does not change while the page is open. */
const neverChanges = () => () => {};

/** No `document`, so no native control — and the `<select>` pair is what gets rendered into the HTML. */
const notOnTheServer = () => false;

/**
 * Does this browser implement `<input type="month">`, or is it a text box
 * wearing the attribute? A control that understands the type refuses a value
 * that is not a month and reports it back as `""`; a text box keeps whatever
 * it was given.
 *
 * **Verified, not assumed** (GAMEEXPLOR-0037): in Playwright's WebKit —
 * `Version/26.5 Safari/605.1.15`, the closest proxy this repo has to the
 * Safari the owner reads the app in — `input.type` reflects back as `"text"`
 * and the string "not a month" survives being assigned. iOS Safari does
 * implement the control, which is why this is a runtime probe and not a
 * blanket decision: the phone gets its month wheel and the Mac gets two
 * selects.
 *
 * Memoised, and read through `useSyncExternalStore` so the server render (no
 * `document`) and the browser render can legitimately differ.
 */
function supportsMonthInput(): boolean {
  if (monthSupport !== null) return monthSupport;
  if (typeof document === "undefined") return false;
  const el = document.createElement("input");
  el.setAttribute("type", "month");
  el.value = "not a month";
  monthSupport = el.type === "month" && el.value === "";
  return monthSupport;
}

/**
 * The granularity a stored run opens at: the **coarser** of its two
 * precisions, because a month shown in a day field would seed the 1st and one
 * tap on Save would enshrine it.
 */
function grainOf(s: PlaySession | undefined): Grain {
  if (!s) return "month";
  return storedPrecision(s.startedPrecision) === "month" || storedPrecision(s.endedPrecision) === "month" ? "month" : "day";
}

/** A stored date as the string its input holds — and, by its shape, the precision it will be read back at. */
function atGrain(d: Date | string, grain: Grain): string {
  return grain === "month" ? monthInput(d) : dateInput(d);
}

/** The submit-button half of the service's `assertOrder`, over the two raw input strings. */
function invertedRange(startedAt: string, endedAt: string): boolean {
  const a = parsePrecise(startedAt);
  const b = parsePrecise(endedAt);
  return !Number.isNaN(a.at.getTime()) && !Number.isNaN(b.at.getTime()) && outOfOrder(a.at, a.precision, b.at, b.precision);
}
