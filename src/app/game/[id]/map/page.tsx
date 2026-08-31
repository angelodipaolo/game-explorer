import { notFound } from "next/navigation";
import { Suspense } from "react";
import { MapViewer } from "@/components/maps/map-viewer";
import { loadGame } from "@/lib/collection";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const game = await loadGame((await params).id);
  return { title: game ? `${game.name} map` : "Map" };
}

/**
 * /game/:id/map?m=<slug> — full-screen interactive map. `m` picks which of the
 * game's maps is showing; the first one when absent.
 */
export default async function MapPage({ params }: { params: Promise<{ id: string }> }) {
  // The route id, not `game.id`: on a game owned on two platforms `loadGame`
  // returns the *primary* copy's id (`groupShelf` sets it to `copies[0]`),
  // while the maps it loaded are this copy's. Handing the viewer `game.id`
  // pointed the back link and the map switcher at a different cartridge, so
  // switching maps navigated to a copy that may not have that slug at all.
  const { id } = await params;
  const game = await loadGame(id);
  if (!game) notFound();
  return (
    <Suspense>
      <MapViewer gameId={id} gameName={game.name} maps={game.maps} />
    </Suspense>
  );
}
