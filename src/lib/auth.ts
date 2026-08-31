/**
 * The whole auth model: **one owner password and N named bearer tokens**.
 *
 * There are no accounts, no roles and no signup — GAMEEXPLOR-0002 put the
 * collection on the public internet behind a Cloudflare Tunnel, and the only
 * thing that has to be told apart is "the owner" from "anyone with the link".
 * Reading is public; every write, and every agent-facing read, is the owner.
 *
 * Two credentials, because the owner is two kinds of client:
 *
 * - a **browser** (the phone, off wifi) → `gx_session`, an HMAC-signed cookie
 *   carrying nothing but its own expiry. Nothing is stored server-side, so a
 *   restart of the mini does not sign the phone out.
 * - an **agent or script** (`.claude/skills/*`, `scripts/import-collection.ts`,
 *   a future iOS client) → `Authorization: Bearer <token>` from `API_TOKENS`,
 *   which is a comma-separated list of `name:token` pairs so one token can be
 *   revoked without changing the others.
 *
 * `OWNER_PASSWORD` is stored in plain text on purpose: it is compared against
 * one password by one person, and hashing it protects nothing that a leaked
 * `.env` (which also holds `AUTH_SECRET` and every API token) has not already
 * given away.
 *
 * No dependencies: HMAC is `crypto.subtle`, which exists in the Node runtime
 * that `src/proxy.ts` and route handlers run in.
 */

/**
 * The session cookie's name — two of them, for one cookie.
 *
 * `__Host-gx_session` is the same value under a name the browser will only
 * accept with `Secure`, `Path=/` and **no** `Domain`. That prefix is why it
 * matters here: nothing else on `angelodipaolo.com` — no other subdomain, no
 * plain-http page — can write a cookie by that name, so a session cookie the
 * server sees under it can only have come from this origin over https. It can
 * still be *cleared* by anyone who can set headers on the domain (that is a
 * sign-out, not a break-in); what it cannot be is forged.
 *
 * The plain name is the fallback for `http://localhost:3000`, where `Secure`
 * is refused and therefore `__Host-` would be too — the same conditional
 * `isSecureRequest` already applies to the `Secure` attribute itself. Reads
 * accept either and prefer the prefixed one.
 */
export const SESSION_COOKIE = "gx_session";
export const SECURE_SESSION_COOKIE = `__Host-${SESSION_COOKIE}`;

/** The name to set on this response: prefixed only where `Secure` is allowed. */
export function sessionCookieName(secure: boolean): string {
  return secure ? SECURE_SESSION_COOKIE : SESSION_COOKIE;
}

/**
 * 30 days, in seconds. Long on purpose: the phone is the primary client and
 * being signed out every week is the thing that makes an owner stop using it.
 */
export const SESSION_MAX_AGE = 60 * 60 * 24 * 30;

/** Just the variables this module reads — `process.env` satisfies it. */
export type AuthEnv = Record<string, string | undefined>;

/**
 * - `enforced` — `OWNER_PASSWORD` and `AUTH_SECRET` are both set. Credentials
 *   decide, in development as well as production: that is what makes auth
 *   testable without deploying.
 * - `open` — neither is set **and `AUTH_OPEN=1` is explicitly present**:
 *   `isOwner` is always true, so `npm run dev` and the Playwright suite need no
 *   setup. `npm run dev` and `playwright.config.ts` set the flag themselves.
 * - `closed` — everything else, including every unset and half-configured
 *   combination: `isOwner` is always false. Fail closed, and say so once.
 *
 * The flag exists because `NODE_ENV` cannot be trusted to say "production".
 * `next start` does **not** set it — a production build launched from a shell
 * where `NODE_ENV=development` leaked in used to open the whole site to the
 * internet with no login, which is the one failure this app cannot have. An
 * env var nobody sets by accident is the difference between a mode you asked
 * for and a mode you inherited.
 */
export type AuthMode = "open" | "enforced" | "closed";

export function authMode(env: AuthEnv = process.env): AuthMode {
  const password = env.OWNER_PASSWORD?.trim();
  const secret = env.AUTH_SECRET?.trim();
  if (password && secret) return "enforced";
  if (!password && !secret && env.AUTH_OPEN?.trim() === "1") return "open";
  return "closed";
}

/**
 * One line, once, when the server can never authenticate anyone.
 *
 * The flag hangs off `globalThis` rather than the module: `src/proxy.ts` and
 * the route handlers are compiled into separate bundles, so a module-level
 * boolean would warn once per bundle and read as a loop in the log.
 */
const WARNED = Symbol.for("game-explorer.auth.warned");
type WarnFlag = { [WARNED]?: boolean };

function warnClosedOnce(env: AuthEnv): void {
  const g = globalThis as WarnFlag;
  if (g[WARNED]) return;
  g[WARNED] = true;
  const missing = [!env.OWNER_PASSWORD?.trim() && "OWNER_PASSWORD", !env.AUTH_SECRET?.trim() && "AUTH_SECRET"].filter(Boolean).join(" and ");
  console.warn(`[auth] ${missing} not set — every write is refused and no one can sign in. See .env.example.`);
}

/** Exported for the tests, which exercise several modes in one process. */
export function resetAuthWarning(): void {
  (globalThis as WarnFlag)[WARNED] = false;
}

/**
 * Constant-time string comparison. Length is folded into the accumulator and
 * the loop always runs the full length of `a`, so neither a wrong length nor a
 * wrong first character returns early.
 *
 * Two empty strings are **not** equal here. Emptiness is not a secret, so the
 * early return leaks nothing, and every caller passes something an attacker
 * controls on one side: "" == "" would turn a missing password or a missing
 * signature into a match the moment the other side was ever empty too.
 */
export function safeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const x = enc.encode(a);
  const y = enc.encode(b);
  if (x.length === 0 || y.length === 0) return false;
  let diff = x.length ^ y.length;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i % (y.length || 1)];
  return diff === 0;
}

function b64url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function unb64url(value: string): string | null {
  try {
    const padded = value.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (value.length % 4)) % 4);
    return atob(padded);
  } catch {
    return null;
  }
}

async function hmac(secret: string, payload: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
  return b64url(new Uint8Array(sig));
}

/**
 * `base64url(expiryMs).base64url(hmacSha256(that))`.
 *
 * The payload is the expiry and nothing else — there is one user, so the
 * cookie has nothing to identify. It is not a JWT and never will be.
 */
export async function signSession(expiresAtMs: number, env: AuthEnv = process.env): Promise<string> {
  const secret = env.AUTH_SECRET?.trim();
  if (!secret) throw new Error("AUTH_SECRET is not set");
  const payload = b64url(new TextEncoder().encode(String(Math.floor(expiresAtMs))));
  return `${payload}.${await hmac(secret, payload)}`;
}

/** True when `value` was signed by this `AUTH_SECRET` and has not expired. */
export async function verifySession(value: string | undefined | null, env: AuthEnv = process.env, now: number = Date.now()): Promise<boolean> {
  const secret = env.AUTH_SECRET?.trim();
  if (!secret || !value) return false;
  const parts = value.split(".");
  if (parts.length !== 2) return false;
  const [payload, signature] = parts;
  if (!safeEqual(signature, await hmac(secret, payload))) return false;
  const raw = unb64url(payload);
  if (raw == null) return false;
  const expiresAt = Number(raw);
  return Number.isFinite(expiresAt) && now < expiresAt;
}

/**
 * Revocation, in full: delete a token's `name:token` pair from `API_TOKENS` to
 * kill that one client, or rotate `AUTH_SECRET` to sign out every browser at
 * once — nothing is stored server-side, so every outstanding session cookie
 * stops verifying the moment the secret changes. Both need a restart.
 */

/**
 * `API_TOKENS="phone:abc123, importer:def456"` → the tokens, with their names
 * for the humans reading `.env`. A bare token with no `name:` prefix works too;
 * the name is never checked, it only exists so one line can be deleted.
 */
export function parseApiTokens(raw: string | undefined): { name: string; token: string }[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const at = entry.indexOf(":");
      if (at < 0) return { name: "", token: entry };
      return { name: entry.slice(0, at).trim(), token: entry.slice(at + 1).trim() };
    })
    .filter((t) => t.token.length > 0);
}

/** The token out of `Authorization: Bearer …`, case-insensitively. */
export function bearerToken(header: string | null | undefined): string | null {
  if (!header) return null;
  const match = /^bearer\s+(.+)$/i.exec(header.trim());
  return match ? match[1].trim() : null;
}

/** True when the header carries one of `API_TOKENS`. Compared in constant time. */
export function matchesApiToken(header: string | null | undefined, env: AuthEnv = process.env): boolean {
  const presented = bearerToken(header);
  if (!presented) return false;
  // `some` short-circuits across tokens, which leaks only *how many* tokens are
  // configured — each individual comparison is still constant time.
  return parseApiTokens(env.API_TOKENS).some((t) => safeEqual(presented, t.token));
}

/** True when `password` is the owner's. False whenever auth is not enforced. */
export function checkOwnerPassword(password: string, env: AuthEnv = process.env): boolean {
  const mode = authMode(env);
  if (mode !== "enforced") {
    if (mode === "closed") warnClosedOnce(env);
    return false;
  }
  return safeEqual(password, env.OWNER_PASSWORD!.trim());
}

/**
 * The owner as seen by a **page**: the session cookie only, since a browser
 * navigation carries no bearer token.
 */
export async function isOwnerSession(cookieValue: string | undefined | null, env: AuthEnv = process.env): Promise<boolean> {
  const mode = authMode(env);
  if (mode === "open") return true;
  if (mode === "closed") {
    warnClosedOnce(env);
    return false;
  }
  return verifySession(cookieValue, env);
}

/** `name=value; other=…` → the value of `name`. */
export function cookieFromHeader(header: string | null | undefined, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const at = part.indexOf("=");
    if (at < 0) continue;
    if (part.slice(0, at).trim() === name) return part.slice(at + 1).trim();
  }
  return undefined;
}

/**
 * The session cookie out of a `Cookie:` header, under either name. The
 * `__Host-` one wins: it is the one a subdomain or a plain-http page could not
 * have written.
 */
export function sessionFromCookieHeader(header: string | null | undefined): string | undefined {
  return cookieFromHeader(header, SECURE_SESSION_COOKIE) ?? cookieFromHeader(header, SESSION_COOKIE);
}

/**
 * The owner as seen by `src/proxy.ts`: a valid session cookie **or** a valid
 * bearer token. Takes anything with `headers` so it can be unit-tested with a
 * plain `Request`.
 */
export async function isOwnerRequest(request: { headers: Headers }, env: AuthEnv = process.env): Promise<boolean> {
  const mode = authMode(env);
  if (mode === "open") return true;
  if (mode === "closed") {
    warnClosedOnce(env);
    return false;
  }
  if (matchesApiToken(request.headers.get("authorization"), env)) return true;
  return verifySession(sessionFromCookieHeader(request.headers.get("cookie")), env);
}

/**
 * Whether the response's cookie may be marked `Secure`.
 *
 * The app is served over plain HTTP on the mini — `cloudflared` terminates TLS
 * and forwards to `localhost:3000` with `x-forwarded-proto: https` — so the
 * public site gets a `Secure` cookie while `http://localhost:3000` still lets
 * you sign in. Hard-coding `Secure` would make the login form silently do
 * nothing on localhost in the browsers that refuse it there.
 */
export function isSecureRequest(request: Request): boolean {
  const forwarded = request.headers.get("x-forwarded-proto");
  if (forwarded) return forwarded.split(",")[0].trim() === "https";
  try {
    return new URL(request.url).protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Every sentence `/login` is allowed to print above the password box.
 *
 * The login route redirects back with `?error=<code>` and the page looks the
 * code up here. It is a fixed map, not a message passed through the query
 * string: anything reflected out of a URL into the page is text an attacker
 * chooses, and "your session expired, call this number" over a real login form
 * is a phishing page hosted on the owner's own domain. An unknown code prints
 * nothing at all.
 */
export const LOGIN_ERRORS = {
  "wrong-password": "wrong password",
  "not-configured": "auth is not configured on this server",
} as const;

export type LoginErrorCode = keyof typeof LOGIN_ERRORS;

export function loginErrorMessage(code: unknown): string | null {
  return typeof code === "string" && Object.hasOwn(LOGIN_ERRORS, code) ? LOGIN_ERRORS[code as LoginErrorCode] : null;
}

/**
 * A redirect target that cannot leave this site.
 *
 * `next` is the one value on the login page an attacker chooses, and it ends up
 * in a `Location:` header — so this is deliberately paranoid, and refuses in
 * three passes rather than one:
 *
 * 1. It must start with `/` and must not start with `//` or `/\`. Both of
 *    those are protocol-relative URLs to a **host**, not paths: a browser
 *    normalises the backslash to a slash, so `/\evil.example` — which starts
 *    with one slash and passes the naive check — lands on `https://evil.example`.
 * 2. No backslash, no control character, no CR or LF anywhere. A newline in a
 *    header value is a header-injection attempt; it is refused here rather than
 *    handed to the runtime, which would throw and turn it into a 500.
 * 3. Resolved against a dummy origin, the result must still be that origin —
 *    the check that holds even if some future URL parser disagrees with the
 *    two above — and only its `pathname` + `search` is returned. Anything with
 *    a scheme (`https:`, `javascript:`) fails this or step 1.
 *
 * Anything refused becomes `fallback`, which is "/" — never an error, so a
 * hostile `next` cannot even make the login page 500.
 */
export function safeNext(value: unknown, fallback = "/"): string {
  const next = typeof value === "string" ? value : "";
  if (!next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) return fallback;
  if (/[\\\u0000-\u001f\u007f]/.test(next)) return fallback;
  try {
    const base = new URL("http://next.invalid");
    const url = new URL(next, base);
    if (url.origin !== base.origin) return fallback;
    return url.pathname + url.search;
  } catch {
    return fallback;
  }
}
