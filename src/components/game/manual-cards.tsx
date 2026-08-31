import Link from "next/link";
import type { ManualWithPages } from "@/lib/manuals/service";
import { Section } from "@/components/game/section";

/**
 * The Manual section on a game page: one compact card per manual, opening the
 * full-screen page-by-page viewer. Nothing here is editable — scans are added
 * through the API (`POST /api/games/:id/manuals`, then a page row and its
 * bytes per page), the same two-step path maps and journal photos use.
 */
export function ManualCards({ gameId, manuals }: { gameId: string; manuals: ManualWithPages[] }) {
  if (!manuals.length) return null;
  return (
    <Section id="manual" title={`Manual${manuals.length > 1 ? "s" : ""}`} count={manuals.length} testId="manual-cards" className="max-w-3xl">
      <div className="flex flex-col gap-2">
        {manuals.map((m) => {
          const cover = m.pages.find((p) => p.width > 0);
          return (
            <Link
              key={m.id}
              href={`/game/${gameId}/manual?m=${encodeURIComponent(m.id)}`}
              prefetch={false}
              className="flex min-h-11 items-center gap-3 rounded-xl border border-border bg-surface p-2 transition hover:-translate-y-0.5 hover:border-muted"
              data-testid="manual-card"
            >
              {/* Page one as the thumbnail: a manual is recognised by its cover. */}
              <div className="h-16 w-12 shrink-0 overflow-hidden rounded-md bg-surface-2">
                {cover ? <img src={`/api/manual-pages/${cover.id}/image`} alt="" loading="lazy" className="h-full w-full object-cover" /> : null}
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-semibold">{m.title}</div>
                <div className="text-[11px] text-muted">
                  {m.pages.length} {m.pages.length === 1 ? "page" : "pages"}
                  {m.note ? ` · ${m.note}` : ""}
                </div>
              </div>
              <span aria-hidden className="shrink-0 pr-1 text-faint">
                ▸
              </span>
            </Link>
          );
        })}
      </div>
    </Section>
  );
}
