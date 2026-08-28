import { Suspense } from "react";
import { Flip } from "@/components/flip/flip";
import { loadShelf } from "@/lib/collection";

export const dynamic = "force-dynamic";
export const metadata = { title: "Flip through" };

export default async function FlipPage() {
  const games = await loadShelf();
  return (
    <Suspense>
      <Flip games={games} />
    </Suspense>
  );
}
