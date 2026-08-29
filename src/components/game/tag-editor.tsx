"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { EffectiveTag } from "@/lib/tags";
import { cx } from "@/components/ui";

type Hidden = { key: string; tag: string };

/**
 * Tags on a game page. IGDB tags can be hidden (never deleted); yours can be
 * removed; agent tags show their citation. Typing suggests tags already in use.
 */
export function TagEditor({ gameId, tags, hidden }: { gameId: string; tags: EffectiveTag[]; hidden: Hidden[] }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [suggestions, setSuggestions] = useState<{ tag: string; count: number }[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!editing) return;
    inputRef.current?.focus();
    fetch("/api/tags")
      .then((r) => r.json())
      .then((list: { tag: string; count: number }[]) => setSuggestions(list))
      .catch(() => {});
  }, [editing]);

  async function call(method: "PUT" | "DELETE", body: object) {
    setBusy(true);
    try {
      const res = await fetch(`/api/games/${gameId}/tags`, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      if (!res.ok) throw new Error((await res.json()).error ?? res.status);
      router.refresh();
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const add = async (tag: string) => {
    const t = tag.trim();
    if (!t) return;
    setDraft("");
    await call("PUT", { tag: t });
  };

  const have = new Set(tags.map((t) => t.key));
  const matching = draft ? suggestions.filter((s) => s.tag.toLowerCase().includes(draft.toLowerCase()) && !have.has(s.tag.toLowerCase())).slice(0, 6) : suggestions.filter((s) => !have.has(s.tag.toLowerCase())).slice(0, 6);

  return (
    <div className="mt-3" data-testid="tag-editor">
      <div className="flex flex-wrap items-center gap-1.5">
        {tags.map((t) => (
          <span
            key={t.key}
            className={cx(
              "inline-flex min-h-8 items-center gap-1 rounded-full px-2.5 text-xs",
              t.source === "igdb" ? "bg-surface text-muted" : t.source === "manual" ? "bg-good/15 text-good" : "bg-accent-2/15 text-accent-2",
            )}
            title={t.source === "igdb" ? "From IGDB" : t.source === "manual" ? "Added by hand" : `Added by an agent${t.sourceUrl ? ` — ${t.sourceUrl}` : ""}`}
          >
            <Link href={`/?tags=${encodeURIComponent(t.tag)}`} className="hover:underline">
              {t.tag}
            </Link>
            {t.source === "agent" && t.sourceUrl ? (
              <a href={t.sourceUrl} target="_blank" rel="noreferrer" className="opacity-70 hover:opacity-100" aria-label="Source">
                ↗
              </a>
            ) : null}
            {editing ? (
              <button
                disabled={busy}
                onClick={() => call("DELETE", { tag: t.tag, igdb: t.source === "igdb" })}
                className="ml-0.5 rounded-full px-1 leading-none hover:bg-bg/40"
                aria-label={t.source === "igdb" ? `Hide ${t.tag}` : `Remove ${t.tag}`}
                title={t.source === "igdb" ? "Hide this IGDB tag for this game" : "Remove"}
              >
                ×
              </button>
            ) : null}
          </span>
        ))}
        <button onClick={() => setEditing((e) => !e)} className="min-h-8 rounded-full border border-dashed border-border px-2.5 text-xs text-muted hover:border-muted hover:text-text" data-testid="edit-tags">
          {editing ? "Done" : "+ tag"}
        </button>
      </div>

      {editing ? (
        <div className="mt-2 rounded-xl border border-border bg-bg-elev p-3">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void add(draft);
            }}
            className="flex gap-2"
          >
            <input
              ref={inputRef}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Add a tag, e.g. Metroidvania"
              aria-label="New tag"
              className="min-h-11 flex-1 rounded-lg border border-border bg-bg px-3 text-base outline-none focus:border-accent"
              data-testid="tag-input"
            />
            <button type="submit" disabled={busy || !draft.trim()} className="min-h-11 rounded-lg bg-accent px-4 text-sm font-semibold text-accent-ink disabled:opacity-40">
              Add
            </button>
          </form>
          {matching.length ? (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {matching.map((s) => (
                <button key={s.tag} disabled={busy} onClick={() => add(s.tag)} className="min-h-8 rounded-full border border-border px-2.5 text-xs text-muted hover:border-muted hover:text-text">
                  {s.tag} <span className="opacity-60">· {s.count}</span>
                </button>
              ))}
            </div>
          ) : null}
          {hidden.length ? (
            <div className="mt-3 text-xs text-faint">
              Hidden IGDB tags:{" "}
              {hidden.map((h) => (
                <button key={h.key} disabled={busy} onClick={() => call("PUT", { tag: h.tag, igdb: true })} className="mr-1 underline hover:text-text" title="Show again">
                  {h.tag}
                </button>
              ))}
            </div>
          ) : null}
          <p className="mt-2 text-[11px] text-faint">Green = yours · blue = added by an agent (↗ cites the source) · grey = IGDB, which can be hidden but not deleted.</p>
        </div>
      ) : null}
    </div>
  );
}
