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
  const game = await loadGame((await params).id);
  if (!game) notFound();
  return (
    <Suspense>
      <MapViewer gameId={game.id} gameName={game.name} maps={game.maps} />
    </Suspense>
  );
}
