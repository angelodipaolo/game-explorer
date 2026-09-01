"use client";

import { useRef, useState } from "react";
import { cachedImageUrl } from "@/lib/images/sizes";
import { Overlay, focusTrigger } from "@/components/overlay";

type Shot = { imageId: string; width: number | null; height: number | null };

export function Screenshots({ shots, title }: { shots: Shot[]; title: string }) {
  const [open, setOpen] = useState<number | null>(null);
  // Focus lands on Close, not on Previous: it is the one control every reader
  // of this overlay wants, and the arrows are one Tab either side of it.
  const closeButton = useRef<HTMLButtonElement>(null);
  if (!shots.length) return null;
  const at = open ?? 0;
  return (
    <>
      <div className="scrollbar-none -mx-4 flex snap-x gap-3 overflow-x-auto px-4 pb-2" data-testid="screenshots">
        {shots.map((s, i) => (
          <button
            key={s.imageId}
            // Safari does not focus a button on click; the viewer hands focus
            // back to whatever had it, so the thumbnail takes it first.
            onClick={(e) => {
              focusTrigger(e);
              setOpen(i);
            }}
            className="w-[78%] shrink-0 snap-center overflow-hidden rounded-xl bg-surface-2 ring-1 ring-white/5 sm:w-[46%] lg:w-[31%]"
            data-testid="screenshot-thumb"
          >
            <img src={cachedImageUrl("screenshot_med", s.imageId)} alt={`${title} screenshot ${i + 1}`} loading="lazy" className="aspect-[16/10] w-full object-cover [image-rendering:pixelated]" />
          </button>
        ))}
      </div>
      {/* A tap anywhere dismisses it, which is why the click is on the overlay
          itself rather than on a backdrop behind the image. */}
      <Overlay
        open={open != null}
        onClose={() => setOpen(null)}
        onClick={() => setOpen(null)}
        label="Screenshot"
        className="z-50 flex items-center justify-center bg-black/90 p-4"
        initialFocus={closeButton}
        testId="screenshot-viewer"
      >
        <img src={cachedImageUrl("1080p", shots[at].imageId)} alt="" className="max-h-full max-w-full rounded-lg [image-rendering:pixelated]" />
        <div className="absolute bottom-6 left-0 right-0 flex justify-center gap-3">
          <button onClick={(e) => (e.stopPropagation(), setOpen((at + shots.length - 1) % shots.length))} className="min-h-12 min-w-12 rounded-xl bg-surface px-5 text-xl" aria-label="Previous screenshot" data-testid="screenshot-prev">
            ◂
          </button>
          <button ref={closeButton} onClick={() => setOpen(null)} className="min-h-12 min-w-12 rounded-xl bg-surface px-5 text-sm" data-testid="screenshot-close">
            Close
          </button>
          <button onClick={(e) => (e.stopPropagation(), setOpen((at + 1) % shots.length))} className="min-h-12 min-w-12 rounded-xl bg-surface px-5 text-xl" aria-label="Next screenshot" data-testid="screenshot-next">
            ▸
          </button>
        </div>
      </Overlay>
    </>
  );
}
