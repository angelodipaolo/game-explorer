import Link from "next/link";
import type { GameMap, MapMarker } from "@prisma/client";

/**
 * The Maps section on a game page: one card per map, each opening the
 * full-screen viewer on that map. Nothing here is editable — maps are made
 * through the API (by you with curl, or by the find-maps skill).
 */
export function MapCards({ gameId, maps }: { gameId: string; maps: (GameMap & { markers: MapMarker[] })[] }) {
  if (!maps.length) return null;
  return (
    <section className="mt-8" data-testid="map-cards">
      <h2 className="mb-3 font-display text-base font-bold">
        Maps <span className="text-muted">· {maps.length}</span>
      </h2>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-[repeat(auto-fill,minmax(180px,1fr))]">
        {maps.map((m) => (
          <Link key={m.id} href={`/game/${gameId}/map?m=${encodeURIComponent(m.slug)}`} className="group overflow-hidden rounded-xl border border-border bg-surface transition hover:-translate-y-0.5 hover:border-muted" data-testid="map-card" prefetch={false}>
            <div className="aspect-square bg-[#0d1a3a]">
              {m.width ? (
                <img src={`/api/maps/${m.id}/image`} alt="" loading="lazy" className="h-full w-full object-cover [image-rendering:pixelated]" />
              ) : (
                <div className="flex h-full items-center justify-center text-xs text-faint">no image</div>
              )}
            </div>
            <div className="px-3 py-2">
              <div className="text-sm font-semibold">{m.title}</div>
              <div className="text-[11px] text-muted">
                {m.markers.length} {m.markers.length === 1 ? "place" : "places"}
                {m.subtitle ? ` · ${m.subtitle}` : ""}
              </div>
            </div>
          </Link>
        ))}
      </div>
    </section>
  );
}
