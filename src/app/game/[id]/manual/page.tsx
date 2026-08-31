import { notFound } from "next/navigation";
import { Suspense } from "react";
import { ManualViewer } from "@/components/manuals/manual-viewer";
import { loadGame } from "@/lib/collection";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const game = await loadGame((await params).id);
  return { title: game ? `${game.name} manual` : "Manual" };
}

/**
 * /game/:id/manual?m=<manualId> — full-screen page-by-page manual. `m` picks
 * which of the copy's manuals is showing; the first one when absent.
 */
export default async function ManualPage({ params }: { params: Promise<{ id: string }> }) {
  // The route id, not `game.id`: on a game owned on two platforms `loadGame`
  // returns the *primary* copy's id, and the manuals it loaded are this copy's.
  const { id } = await params;
  const game = await loadGame(id);
  if (!game) notFound();
  return (
    <Suspense>
      <ManualViewer gameId={id} gameName={game.name} manuals={game.manuals} />
    </Suspense>
  );
}
