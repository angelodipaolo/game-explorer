import { NextResponse } from "next/server";
import { LOGIN_ERRORS, SESSION_MAX_AGE, authMode, checkOwnerPassword, isSecureRequest, safeNext, sessionCookieName, signSession, type LoginErrorCode } from "@/lib/auth";

export const dynamic = "force-dynamic";

/**
 * POST /api/auth/login — the owner's password in, the session cookie out.
 *
 * Two shapes, one path:
 *
 * - a **form post** from `/login` (what the phone actually does) answers with
 *   a 303 back to `next`, so signing in works with JavaScript disabled and a
 *   wrong password lands back on the page with an error rather than on a
 *   JSON blob.
 * - a **JSON post** answers with JSON, for curl, tests and a future iOS client.
 *
 * There is no lockout and no rate limit: one password, a family-sized audience,
 * and Cloudflare in front. Adding a counter here would mostly be a way to lock
 * the owner out from their own phone.
 */
export async function POST(request: Request) {
  const wantsJson = (request.headers.get("content-type") ?? "").includes("application/json");
  let password = "";
  let next = "/";
  if (wantsJson) {
    const body = (await request.json().catch(() => null)) as { password?: unknown; next?: unknown } | null;
    password = typeof body?.password === "string" ? body.password : "";
    next = safeNext(body?.next);
  } else {
    const form = await request.formData().catch(() => null);
    password = String(form?.get("password") ?? "");
    next = safeNext(form?.get("next"));
  }

  if (authMode() !== "enforced") {
    return refuse(wantsJson, next, 503, "not-configured");
  }
  if (!checkOwnerPassword(password)) {
    return refuse(wantsJson, next, 401, "wrong-password");
  }

  const value = await signSession(Date.now() + SESSION_MAX_AGE * 1000);
  const secure = isSecureRequest(request);
  const response = wantsJson ? NextResponse.json({ ok: true }) : seeOther(next);
  response.cookies.set({
    // `__Host-` over https, the plain name over http — see src/lib/auth.ts.
    name: sessionCookieName(secure),
    value,
    httpOnly: true,
    sameSite: "lax",
    secure,
    // `path: "/"` and no `domain` are what `__Host-` requires; they are also
    // what this app wants regardless.
    path: "/",
    maxAge: SESSION_MAX_AGE,
  });
  return response;
}

/**
 * A **relative** `Location`, which RFC 7231 allows and every browser follows.
 *
 * `NextResponse.redirect` needs an absolute URL, and the one it would build
 * comes from `request.url` — which `next start` reports with its own hostname
 * rather than the `Host` the client used. Redirecting to a different hostname
 * than the one the cookie was just set for signs you straight back out, and
 * behind the tunnel it would send the public browser to `localhost:3000`.
 */
function seeOther(location: string) {
  return new NextResponse(null, { status: 303, headers: { location } });
}

/**
 * A refused sign-in: JSON for a machine, back to the form for a browser.
 *
 * `error` is a **code** from a fixed set (`LOGIN_ERRORS` in src/lib/auth.ts),
 * never a message. The query string comes back to the browser and is rendered
 * on the page, so reflecting arbitrary text there would let anyone with a link
 * put whatever sentence they liked above the password box.
 */
function refuse(wantsJson: boolean, next: string, status: number, error: LoginErrorCode) {
  if (wantsJson) return NextResponse.json({ error: LOGIN_ERRORS[error] }, { status });
  const params = new URLSearchParams({ error });
  if (next !== "/") params.set("next", next);
  return seeOther(`/login?${params}`);
}
