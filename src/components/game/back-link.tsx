"use client";

import Link from "next/link";
import { useSyncExternalStore } from "react";

function subscribe() {
  return () => {};
}
function read(): string {
  try {
    return window.sessionStorage.getItem("shelf:last") || "/";
  } catch {
    return "/";
  }
}

/** Back to wherever the shelf was last filtered to, so the set survives opening a game. */
export function BackLink() {
  const href = useSyncExternalStore(subscribe, read, () => "/");
  const label = href.startsWith("/flip") ? "◂ Back to flipping" : "◂ Shelf";
  return (
    <Link href={href} className="inline-flex min-h-11 items-center rounded-xl px-2 text-sm text-muted hover:text-text" data-testid="back-link">
      {label}
    </Link>
  );
}
