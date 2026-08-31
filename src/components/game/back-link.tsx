"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useSyncExternalStore } from "react";

function subscribe() {
  return () => {};
}
/** Where the shelf was last left. Nothing remembered yet means the shelf itself, not home. */
function read(): string {
  try {
    return window.sessionStorage.getItem("shelf:last") || "/shelf";
  } catch {
    return "/shelf";
  }
}

/**
 * Back to wherever the shelf was last filtered to. When we got here from
 * inside the app, go back through history so the browser restores the
 * scroll position; a page opened from a shared link falls back to the URL.
 */
export function BackLink() {
  const href = useSyncExternalStore(subscribe, read, () => "/shelf");
  const router = useRouter();
  const label = href.startsWith("/flip") ? "◂ Back to flipping" : "◂ Shelf";
  return (
    <Link
      href={href}
      onClick={(e) => {
        let cameFromApp = false;
        try {
          cameFromApp = window.history.length > 1 && window.sessionStorage.getItem("shelf:last") != null;
        } catch {}
        if (cameFromApp) {
          e.preventDefault();
          router.back();
        }
      }}
      className="inline-flex min-h-11 items-center rounded-xl px-2 text-sm text-muted hover:text-text"
      data-testid="back-link"
    >
      {label}
    </Link>
  );
}
