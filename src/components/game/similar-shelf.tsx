"use client";

import Link from "next/link";
import { useState } from "react";
import { Cover } from "@/components/shelf/cover";
import { cx } from "@/components/ui";
import { Section } from "@/components/game/section";

export type SimilarItem = { id: string; name: string; cover: string | null; platformLabel: string | null; why: "igdb" | "tags" };
export type NotOwnedItem = { igdbId: number; name: string; cover: string | null };

/** Covers shown before "show N more". */
const ROW = 6;

/**
 * "Similar, and on the shelf" — moved to the last content section (step 5),
 * after Journal: by the time you have read the codes, the guides and the
 * journal, "what else is like this" is the natural next question, not the
 * first one.
 *
 * Trimmed to one row of 6 by default; the rest is a tap away rather than a
 * long scroll. `Similar, not owned` stays a plain `<details>` nested inside,
 * unchanged — it was already the quiet, low-emphasis half of this section.
 */
export function SimilarShelf({ onShelf, notOwned }: { onShelf: SimilarItem[]; notOwned: NotOwnedItem[] }) {
  const [expanded, setExpanded] = useState(false);
  const shown = expanded ? onShelf : onShelf.slice(0, ROW);
  return (
    <Section id="similar" title="Similar, and on the shelf" count={onShelf.length} collapsible defaultOpen storageKey="similar">
      {onShelf.length ? (
        <>
          <div className="grid grid-cols-3 gap-3 sm:grid-cols-[repeat(auto-fill,minmax(120px,1fr))]" data-testid="similar-owned">
            {shown.map((s) => (
              <Link key={s.id} href={`/game/${s.id}`} className="group" prefetch={false}>
                <Cover imageId={s.cover} title={s.name} className={cx("transition group-hover:-translate-y-1", s.why === "igdb" && "ring-2 ring-accent/70")} />
                <div className="mt-1.5 line-clamp-2 text-xs font-medium">{s.name}</div>
                <div className="text-[11px] text-muted">{s.platformLabel}</div>
              </Link>
            ))}
          </div>
          {onShelf.length > ROW ? (
            <button onClick={() => setExpanded((e) => !e)} className="mt-3 min-h-11 text-xs text-muted underline hover:text-text" data-testid="similar-show-more">
              {expanded ? "Show fewer" : `Show ${onShelf.length - ROW} more`}
            </button>
          ) : null}
        </>
      ) : (
        <p className="text-sm text-faint">Nothing on the shelf looks similar yet — tags would help here.</p>
      )}
      {notOwned.length ? (
        <details className="mt-4 group">
          <summary className="cursor-pointer text-sm text-muted hover:text-text">Similar, not owned · {notOwned.length}</summary>
          <div className="mt-3 grid grid-cols-4 gap-2 opacity-60 sm:grid-cols-[repeat(auto-fill,minmax(90px,1fr))]" data-testid="similar-not-owned">
            {notOwned.map((s) => (
              <div key={s.igdbId}>
                <Cover imageId={s.cover} title={s.name} size="small" />
                <div className="mt-1 line-clamp-2 text-[11px]">{s.name}</div>
              </div>
            ))}
          </div>
        </details>
      ) : null}
    </Section>
  );
}
