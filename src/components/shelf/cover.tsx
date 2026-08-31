import { cx } from "@/components/ui";
import { cachedImageUrl, type ImageSize } from "@/lib/images/sizes";

type Size = "small" | "big" | "huge";
const sizes: Record<Size, ImageSize> = { small: "cover_small", big: "cover_big", huge: "cover_big_2x" };

/** Covers come from the local disk cache, which backfills from IGDB on a miss. */
export function coverUrl(imageId: string, size: Size = "big"): string {
  return cachedImageUrl(sizes[size], imageId);
}

/** Cover art, or a typographic tile when IGDB has none. Always 3:4. */
export function Cover({ imageId, title, size = "big", className, priority }: { imageId: string | null; title: string; size?: Size; className?: string; priority?: boolean }) {
  return (
    <div className={cx("relative aspect-[3/4] overflow-hidden rounded-xl bg-surface-2", className)}>
      {imageId ? (
        <img
          src={coverUrl(imageId, size)}
          alt={title}
          loading={priority ? "eager" : "lazy"}
          decoding="async"
          className="h-full w-full object-cover"
          draggable={false}
        />
      ) : (
        <div className="flex h-full w-full items-end bg-gradient-to-br from-surface-2 to-bg-elev p-3">
          <span className="font-display text-sm font-bold leading-tight text-muted">{title}</span>
        </div>
      )}
    </div>
  );
}
