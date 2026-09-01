import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { isOwnerRequest } from "@/lib/auth";

/**
 * The one gate in front of the whole app (GAMEEXPLOR-0002).
 *
 * Next 16's `proxy.ts` is the former `middleware.ts` — same position in the
 * request chain, Node runtime, one exported function. It runs before any route
 * is rendered, which is exactly the property this file is for: **a new
 * `/api/*` route is behind auth the moment it exists**, without its author
 * remembering anything. Nothing under `src/app/api/` should ever check
 * credentials itself, and nothing should ever be exempted from here without
 * the reason being written down next to the exemption.
 *
 * It does two jobs:
 *
 * 1. **Auth.** Every `/api/*` request needs the owner (session cookie or
 *    bearer token) except the public-image allowlist below; owner-only *pages*
 *    redirect to `/login`. Public pages are untouched — anyone with the link
 *    reads the shelf.
 * 2. **`X-Robots-Tag: noindex`** on every response, belt and braces with
 *    `robots.ts` and the `metadata.robots` in the root layout. The collection
 *    is for friends and family with the link, not for search engines.
 */

/**
 * Pages only the owner may open. They are the curation tools: everything they
 * do is a write, so a read-only visitor has nothing to look at.
 *
 * `/series/:slug/edit` (GAMEEXPLOR-0020) has to be a **pattern** rather than a
 * literal, because the slug is part of the path and every series has its own.
 * `[^/]+` and the anchored `/edit$` are what keep it from over-reaching: the
 * series page itself, `/series/:slug`, stays public — reading a series is the
 * whole point of the page, and the "Edit" control on it is drawn from the
 * server-derived `canEdit`, never from this list. `/series/new` keeps its own
 * literal above; `[^/]+` would match "new" only for `/series/new/edit`, which
 * is not a route.
 *
 * `/playing` is deliberately **not** here — it is a view of the collection, and
 * it renders its lists read-only for a visitor (`Viewer.canEdit`).
 */
const OWNER_PAGES = [/^\/import(\/|$)/, /^\/series\/new$/, /^\/series\/[^/]+\/edit$/];

/**
 * Whether this path is one of them. Exported for `src/lib/auth.test.ts`, which
 * is where the rule is pinned down: the difference between a public page and a
 * curation tool is one regex, and getting it wrong in either direction — a
 * public page behind a login, a write surface in front of one — is silent.
 */
export function isOwnerPage(pathname: string): boolean {
  return OWNER_PAGES.some((r) => r.test(pathname));
}

/**
 * The API allowlist — the *only* exemptions from auth, and both halves of it
 * are pixels the public pages need.
 *
 * - `/api/auth/*`: the login and logout endpoints. A gate you must already be
 *   through to reach makes signing in impossible.
 * - `/api/img/*`: every cover and screenshot on the shelf, home, flip and game
 *   pages goes through this route (GAMEEXPLOR-0007's disk cache). Gating it
 *   would serve a public site of blank rectangles — the opposite of the point
 *   of hosting this. It is read-only by construction: the route file exports
 *   `GET` and nothing else.
 * - `GET` (and `HEAD`, which Next answers with the same handler minus the
 *   body) on a map image, a journal photo and a manual page scan: the same
 *   argument, for the `<img>` tags on the game, map and manual pages. **Only
 *   those two verbs.** `PUT /api/maps/:id/image` writes bytes to disk and stays
 *   behind auth, as do the JSON routes that list or describe any of these.
 *   The `:id` in those three is attacker-chosen and reaches a file path, which
 *   is why `isSafeImageId` (src/lib/media/image-store.ts) refuses anything but
 *   a bare row id — a `%2F..%2F` in there used to read files off the disk.
 * - `GET`/`HEAD` on `/api/music/games/:ownedGameId` and
 *   `/api/music/tracks/:trackId` (GAMEEXPLOR-0025): the same argument again,
 *   for the `<audio>` element the root layout mounts. A public game page that
 *   plays no music for a visitor would be a login prompt hidden inside a
 *   background sound. Both are read-only — the route files export `GET` and
 *   nothing else — and neither takes a path: the track id must be in
 *   `data/music/index.json`, which is a file only the owner writes, on the
 *   server's own disk. An id that is not registered is a 404 before anything
 *   touches the filesystem, and the manifest's own file field is resolved and
 *   re-checked against `data/music/` (src/lib/music/library.ts). There is no
 *   listing route: nothing enumerates the directory, so an id is either one a
 *   game page just handed out or a guess.
 *
 * Every other `/api/*` request — including GETs like `/api/tags`,
 * `/api/codes/gaps` and `/api/enrichment/gaps` — needs the owner: those are
 * agent-facing endpoints that enumerate the collection, not page data.
 */
function isPublicApi(pathname: string, method: string): boolean {
  if (pathname.startsWith("/api/auth/")) return true;
  if (pathname.startsWith("/api/img/")) return true;
  if (method !== "GET" && method !== "HEAD") return false;
  return /^\/api\/maps\/[^/]+\/image$/.test(pathname) || /^\/api\/journal\/[^/]+\/image$/.test(pathname) || /^\/api\/manual-pages\/[^/]+\/image$/.test(pathname) || /^\/api\/music\/(?:games|tracks)\/[^/]+$/.test(pathname);
}

async function gate(request: NextRequest, pathname: string): Promise<NextResponse> {
  const isApi = pathname.startsWith("/api/");
  const ownerPage = isOwnerPage(pathname);
  if (!isApi && !ownerPage) return NextResponse.next();
  if (isApi && isPublicApi(pathname, request.method)) return NextResponse.next();
  if (await isOwnerRequest(request)) return NextResponse.next();

  // An agent gets a machine-readable 401 (the skills are told to stop on one);
  // a browser opening a curation page gets sent somewhere it can do something.
  if (isApi) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  // Absolute, from `nextUrl` — a relative `Location` is not an option here,
  // Next parses this one as a URL and 500s on a path. `nextUrl` carries the
  // `Host` the client asked for, so this stays on the tunnel's domain; the
  // scheme is `http` because `cloudflared` forwards over http, and Cloudflare's
  // "Always use HTTPS" turns that hop back into https at the edge.
  const url = request.nextUrl.clone();
  url.pathname = "/login";
  url.search = "";
  url.searchParams.set("next", pathname + request.nextUrl.search);
  return NextResponse.redirect(url);
}

export async function proxy(request: NextRequest): Promise<NextResponse> {
  const response = await gate(request, request.nextUrl.pathname);
  response.headers.set("X-Robots-Tag", "noindex, nofollow");
  return response;
}

export const config = {
  // Everything except build output, so the `noindex` header rides on every
  // page and API response rather than only the guarded ones.
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
