"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { GameCode } from "@prisma/client";
import { CODE_KINDS, KIND_LABELS, KIND_OPTIONS, MAX_CODES_PER_GAME, kindRank, type CodeKind } from "@/lib/codes/kinds";
import { cx } from "@/components/ui";

/**
 * Codes on a game page: passwords, cheats, Game Genie. Read-only until you
 * press "+ code".
 *
 * Every row looks the same whoever wrote it — there are no provenance badges
 * here, because a code typed in by hand and a code written by a research skill
 * are the same kind of record. The one-handed path is the copy button: read a
 * Game Genie code off the phone while typing it into the console.
 */
export function CodeList({ gameId, codes }: { gameId: string; codes: GameCode[] }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [adding, setAdding] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function call(method: "POST" | "PATCH" | "DELETE", body: object | null, codeId?: string) {
    setBusy(true);
    try {
      const url = codeId ? `/api/games/${gameId}/codes/${codeId}` : `/api/games/${gameId}/codes`;
      const res = await fetch(url, { method, headers: { "content-type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) });
      if (!res.ok) throw new Error((await res.json()).error ?? res.status);
      setAdding(false);
      setEditId(null);
      router.refresh();
      return true;
    } catch (e) {
      alert((e as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  }

  const groups: { kind: string; rows: GameCode[] }[] = CODE_KINDS.map((kind) => ({ kind: kind as string, rows: codes.filter((c) => c.kind === kind) })).filter((g) => g.rows.length);
  // A code written with a kind this build no longer knows about still has to show up.
  for (const c of codes) {
    if (kindRank(c.kind) < CODE_KINDS.length) continue;
    const g = groups.find((x) => x.kind === c.kind);
    if (g) g.rows.push(c);
    else groups.push({ kind: c.kind, rows: [c] });
  }
  const full = codes.length >= MAX_CODES_PER_GAME;

  return (
    // Capped width: a code and its copy button should stay in one glance rather
    // than sit at opposite ends of a wide screen.
    <section className="mt-8 max-w-3xl" data-testid="code-list">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="font-display text-base font-bold">
          Codes &amp; passwords {codes.length ? <span className="text-muted">· {codes.length}</span> : null}
        </h2>
        {codes.length ? (
          <button onClick={() => setEditing((e) => !e)} className="min-h-8 rounded-full border border-border px-3 text-xs text-muted hover:border-muted hover:text-text" data-testid="edit-codes">
            {editing ? "Done" : "Edit"}
          </button>
        ) : null}
      </div>

      {groups.map((g) => (
        <KindGroup
          key={g.kind}
          kind={g.kind}
          rows={g.rows}
          editing={editing}
          busy={busy}
          editId={editId}
          onEdit={setEditId}
          onSubmit={(body, id) => call("PATCH", body, id)}
          onDelete={(c) => {
            if (confirm(`Delete "${c.effect}"?`)) void call("DELETE", null, c.id);
          }}
        />
      ))}

      {adding ? (
        <CodeForm busy={busy} onCancel={() => setAdding(false)} onSubmit={(body) => call("POST", body)} />
      ) : (
        <button
          onClick={() => setAdding(true)}
          disabled={full}
          title={full ? `A game holds at most ${MAX_CODES_PER_GAME} codes` : undefined}
          className="min-h-11 rounded-xl border border-dashed border-border px-4 text-sm text-muted hover:border-muted hover:text-text disabled:opacity-40"
          data-testid="add-code"
        >
          + code
        </button>
      )}
      {!codes.length && !adding ? <p className="mt-2 text-xs text-faint">Passwords, cheats and Game Genie codes for this copy.</p> : null}
    </section>
  );
}

/** How many rows of a kind show before the expander. The cap is 30, so a long
 *  password list stays one tap away rather than pushing the page down. */
const FOLD = 6;

function KindGroup({
  kind,
  rows,
  editing,
  busy,
  editId,
  onEdit,
  onSubmit,
  onDelete,
}: {
  kind: string;
  rows: GameCode[];
  editing: boolean;
  busy: boolean;
  editId: string | null;
  onEdit: (id: string | null) => void;
  onSubmit: (body: FormBody, id: string) => Promise<boolean>;
  onDelete: (c: GameCode) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  // Never fold away the row being edited.
  const open = expanded || (editId != null && rows.some((r) => r.id === editId));
  const shown = open ? rows : rows.slice(0, FOLD);
  return (
    <div className="mb-4">
      <h3 className="mb-2 font-display text-sm font-bold text-muted">{KIND_LABELS[kind as CodeKind] ?? kind}</h3>
      <ul className="flex flex-col gap-2">
        {shown.map((c) =>
          editId === c.id ? (
            <li key={c.id}>
              <CodeForm initial={c} busy={busy} onCancel={() => onEdit(null)} onSubmit={(body) => onSubmit(body, c.id)} onDelete={() => onDelete(c)} />
            </li>
          ) : (
            <CodeRow key={c.id} code={c} editing={editing} busy={busy} onEdit={() => onEdit(c.id)} />
          ),
        )}
      </ul>
      {rows.length > FOLD ? (
        <button onClick={() => setExpanded((e) => !e)} className="mt-2 min-h-11 text-xs text-muted underline hover:text-text" data-testid="expand-codes">
          {open ? "Show fewer" : `Show all ${rows.length}`}
        </button>
      ) : null}
    </div>
  );
}

function CodeRow({ code: c, editing, busy, onEdit }: { code: GameCode; editing: boolean; busy: boolean; onEdit: () => void }) {
  const [copied, setCopied] = useState(false);
  return (
    <li className="rounded-xl border border-border bg-surface p-3" data-testid="code-row">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5 text-sm font-medium">
            <span>{c.effect}</span>
            {c.verified ? (
              <span className="text-good" title="Tried on hardware — it works" aria-label="verified">
                ✓
              </span>
            ) : null}
            {c.sourceUrl ? (
              <a href={c.sourceUrl} target="_blank" rel="noreferrer" className="text-muted opacity-70 hover:opacity-100" title={c.sourceUrl} aria-label="Source">
                ↗
              </a>
            ) : null}
          </div>
          {c.code ? <div className="mt-1 inline-block rounded-md bg-surface-2 px-2 py-1 font-mono text-base tracking-wide break-all">{c.code}</div> : null}
          {c.howTo ? <div className="mt-1 text-xs leading-relaxed text-muted">{c.howTo}</div> : null}
          {c.note ? <div className="mt-1 text-xs text-faint">{c.note}</div> : null}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {c.code ? (
            <button
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(c.code!);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1200);
                } catch {
                  alert("Could not reach the clipboard");
                }
              }}
              className="min-h-11 min-w-11 rounded-lg border border-border px-2 text-xs text-muted hover:border-muted hover:text-text"
              aria-label={`Copy ${c.code}`}
              data-testid="copy-code"
            >
              {copied ? "✓" : "Copy"}
            </button>
          ) : null}
          {editing ? (
            <button onClick={onEdit} disabled={busy} className="min-h-11 min-w-11 rounded-lg border border-border px-2 text-xs text-muted hover:border-muted hover:text-text" aria-label={`Edit ${c.effect}`}>
              Edit
            </button>
          ) : null}
        </div>
      </div>
    </li>
  );
}

type FormBody = { kind: string; effect: string; code: string | null; howTo: string | null; sourceUrl: string | null; note: string | null; verified: boolean };

function CodeForm({ initial, busy, onCancel, onSubmit, onDelete }: { initial?: GameCode; busy: boolean; onCancel: () => void; onSubmit: (body: FormBody) => Promise<boolean>; onDelete?: () => void }) {
  const [kind, setKind] = useState<string>(initial?.kind ?? "password");
  const [effect, setEffect] = useState(initial?.effect ?? "");
  const [code, setCode] = useState(initial?.code ?? "");
  const [howTo, setHowTo] = useState(initial?.howTo ?? "");
  const [sourceUrl, setSourceUrl] = useState(initial?.sourceUrl ?? "");
  const [note, setNote] = useState(initial?.note ?? "");
  const [verified, setVerified] = useState(initial?.verified ?? false);

  const field = "min-h-11 w-full rounded-lg border border-border bg-bg px-3 text-base outline-none focus:border-accent";
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void onSubmit({ kind, effect, code: code.trim() || null, howTo: howTo.trim() || null, sourceUrl: sourceUrl.trim() || null, note: note.trim() || null, verified });
      }}
      className="rounded-xl border border-border bg-bg-elev p-3"
      data-testid="code-form"
    >
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="text-xs text-muted">
          Kind
          <select value={kind} onChange={(e) => setKind(e.target.value)} className={cx(field, "mt-1")} aria-label="Kind">
            {CODE_KINDS.map((k) => (
              <option key={k} value={k}>
                {KIND_OPTIONS[k]}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs text-muted">
          What it does
          <input value={effect} onChange={(e) => setEffect(e.target.value)} placeholder="Infinite lives" required className={cx(field, "mt-1")} aria-label="What it does" data-testid="code-effect" />
        </label>
        <label className="text-xs text-muted">
          Code <span className="text-faint">— leave blank if the button sequence is the code</span>
          <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="SXIOPO" className={cx(field, "mt-1 font-mono")} aria-label="Code" data-testid="code-value" />
        </label>
        <label className="text-xs text-muted">
          Source link
          <input value={sourceUrl} onChange={(e) => setSourceUrl(e.target.value)} type="url" placeholder="https://…" className={cx(field, "mt-1")} aria-label="Source link" />
        </label>
        <label className="text-xs text-muted sm:col-span-2">
          How to enter it
          <input value={howTo} onChange={(e) => setHowTo(e.target.value)} placeholder="At the title screen, press Up Up Down Down…" className={cx(field, "mt-1")} aria-label="How to enter it" />
        </label>
        <label className="text-xs text-muted sm:col-span-2">
          Note
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Anything else worth knowing" className={cx(field, "mt-1")} aria-label="Note" />
        </label>
      </div>
      <label className="mt-2 flex min-h-11 items-center gap-2 text-sm text-muted">
        <input type="checkbox" checked={verified} onChange={(e) => setVerified(e.target.checked)} className="size-4 accent-[var(--color-accent)]" />
        Tried on hardware — it works
      </label>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button type="submit" disabled={busy || !effect.trim()} className="min-h-11 rounded-lg bg-accent px-4 text-sm font-semibold text-accent-ink disabled:opacity-40" data-testid="save-code">
          Save
        </button>
        <button type="button" onClick={onCancel} disabled={busy} className="min-h-11 rounded-lg border border-border px-4 text-sm text-muted hover:border-muted hover:text-text">
          Cancel
        </button>
        {onDelete ? (
          <button type="button" onClick={onDelete} disabled={busy} className="ml-auto min-h-11 rounded-lg border border-bad/30 bg-bad/10 px-4 text-sm text-bad hover:bg-bad/20" data-testid="delete-code">
            Delete
          </button>
        ) : null}
      </div>
    </form>
  );
}
