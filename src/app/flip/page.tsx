import { Suspense } from "react";
import { Flip } from "@/components/flip/flip";
import { loadShelf } from "@/lib/collection";
import { readViewer } from "@/lib/viewer";

export const dynamic = "force-dynamic";
export const metadata = { title: "Flip through" };

export default async function FlipPage() {
  const [games, viewer] = await Promise.all([loadShelf(), readViewer()]);
  return (
    <Suspense>
      <Flip games={games} viewer={viewer} />
    </Suspense>
  );
}
