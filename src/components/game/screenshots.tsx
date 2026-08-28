"use client";

import { useState } from "react";

type Shot = { imageId: string; width: number | null; height: number | null };

export function Screenshots({ shots, title }: { shots: Shot[]; title: string }) {
  const [open, setOpen] = useState<number | null>(null);
  if (!shots.length) return null;
  return (
    <>
      <div className="scrollbar-none -mx-4 flex snap-x gap-3 overflow-x-auto px-4 pb-2" data-testid="screenshots">
        {shots.map((s, i) => (
          <button key={s.imageId} onClick={() => setOpen(i)} className="w-[78%] shrink-0 snap-center overflow-hidden rounded-xl bg-surface-2 ring-1 ring-white/5 sm:w-[46%] lg:w-[31%]">
            <img src={`https://images.igdb.com/igdb/image/upload/t_screenshot_med/${s.imageId}.jpg`} alt={`${title} screenshot ${i + 1}`} loading="lazy" className="aspect-[16/10] w-full object-cover [image-rendering:pixelated]" />
          </button>
        ))}
      </div>
      {open != null ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 p-4" onClick={() => setOpen(null)} role="dialog" aria-label="Screenshot">
          <img src={`https://images.igdb.com/igdb/image/upload/t_1080p/${shots[open].imageId}.jpg`} alt="" className="max-h-full max-w-full rounded-lg [image-rendering:pixelated]" />
          <div className="absolute bottom-6 left-0 right-0 flex justify-center gap-3">
            <button onClick={(e) => (e.stopPropagation(), setOpen((open + shots.length - 1) % shots.length))} className="min-h-12 rounded-xl bg-surface px-5 text-xl" aria-label="Previous screenshot">
              ◂
            </button>
            <button onClick={() => setOpen(null)} className="min-h-12 rounded-xl bg-surface px-5 text-sm">
              Close
            </button>
            <button onClick={(e) => (e.stopPropagation(), setOpen((open + 1) % shots.length))} className="min-h-12 rounded-xl bg-surface px-5 text-xl" aria-label="Next screenshot">
              ▸
            </button>
          </div>
        </div>
      ) : null}
    </>
  );
}
