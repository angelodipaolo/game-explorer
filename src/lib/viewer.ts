import { cookies } from "next/headers";
import { SECURE_SESSION_COOKIE, SESSION_COOKIE, authMode, isOwnerSession } from "@/lib/auth";

/**
 * Who is looking at this page.
 *
 * `canEdit` is derived on the **server**, from the session cookie, and drilled
 * down as a prop — no client-side auth check decides what a write control does,
 * it decides only whether one is drawn. The API is guarded independently by
 * `src/proxy.ts`, so a hidden button is a courtesy, never the fence.
 *
 * `enforced` is what the sign-in affordance keys off: on a laptop running
 * `npm run dev` with no auth configured everyone is the owner, and offering to
 * "sign out" of a server with no login would be nonsense.
 */
export type Viewer = { canEdit: boolean; enforced: boolean };

export async function readViewer(): Promise<Viewer> {
  const store = await cookies();
  // Either cookie name — `__Host-` first, since that is the one no subdomain
  // and no plain-http page could have written. See src/lib/auth.ts.
  const session = store.get(SECURE_SESSION_COOKIE)?.value ?? store.get(SESSION_COOKIE)?.value;
  return {
    canEdit: await isOwnerSession(session),
    enforced: authMode() === "enforced",
  };
}
