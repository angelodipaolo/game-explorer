import { NextResponse } from "next/server";
import { SECURE_SESSION_COOKIE, SESSION_COOKIE, isSecureRequest, safeNext } from "@/lib/auth";

export const dynamic = "force-dynamic";

/**
 * POST /api/auth/logout — clear the session cookie.
 *
 * Nothing is stored server-side, so signing out is exactly this: expire the
 * cookie. A form post (the "Sign out" control) gets a 303 home; a JSON post
 * gets JSON.
 */
export async function POST(request: Request) {
  const wantsJson = (request.headers.get("content-type") ?? "").includes("application/json");
  const form = wantsJson ? null : await request.formData().catch(() => null);
  const next = safeNext(form?.get("next"));

  // Relative `Location` for the same reason as the login route: it must land
  // on the host the browser actually used.
  const response = wantsJson ? NextResponse.json({ ok: true }) : new NextResponse(null, { status: 303, headers: { location: next } });
  // Both names, always: the session may have been set under `__Host-gx_session`
  // (https) or `gx_session` (localhost), and signing out has to clear whichever
  // one this browser is holding.
  const secure = isSecureRequest(request);
  for (const name of [SECURE_SESSION_COOKIE, SESSION_COOKIE]) {
    response.cookies.set({
      name,
      value: "",
      httpOnly: true,
      sameSite: "lax",
      // `__Host-` is only accepted with `Secure`, so clearing it over plain
      // http is a no-op the browser ignores — harmless, and there is nothing
      // to clear there anyway.
      secure: name === SECURE_SESSION_COOKIE ? true : secure,
      path: "/",
      maxAge: 0,
    });
  }
  return response;
}
