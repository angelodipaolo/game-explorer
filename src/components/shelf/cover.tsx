import { cx } from "@/components/ui";

type Size = "small" | "big" | "huge";
const sizes: Record<Size, string> = { small: "t_cover_small", big: "t_cover_big", huge: "t_cover_big_2x" };

export function coverUrl(imageId: string, size: Size = "big"): string {
  return `https://images.igdb.com/igdb/image/upload/${sizes[size]}/${imageId}.jpg`;
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
