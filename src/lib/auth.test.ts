import { afterEach, describe, expect, it, vi } from "vitest";
import { isOwnerPage } from "@/proxy";
import {
  SECURE_SESSION_COOKIE,
  SESSION_COOKIE,
  authMode,
  bearerToken,
  checkOwnerPassword,
  cookieFromHeader,
  isOwnerRequest,
  isOwnerSession,
  isSecureRequest,
  loginErrorMessage,
  matchesApiToken,
  parseApiTokens,
  resetAuthWarning,
  safeEqual,
  safeNext,
  sessionCookieName,
  sessionFromCookieHeader,
  signSession,
  verifySession,
} from "./auth";

/**
 * Every case here passes its own env object rather than touching
 * `process.env`: the three modes have to be exercised in one process, and the
 * one that matters most — "production with nothing configured" — must never
 * leak into another test file.
 */
const ENFORCED = { OWNER_PASSWORD: "hunter2", AUTH_SECRET: "s3cret-signing-key", API_TOKENS: "phone:tok-phone, importer:tok-import" };
/** Open mode is the explicit flag now, not an inferred `NODE_ENV`. */
const OPEN = { AUTH_OPEN: "1", NODE_ENV: "development" };
const PROD_UNSET = { NODE_ENV: "production" };

const req = (headers: Record<string, string> = {}) => new Request("http://localhost:3000/api/tags", { headers });

afterEach(() => {
  resetAuthWarning();
  vi.restoreAllMocks();
});

describe("authMode", () => {
  it("enforces when both the password and the secret are set — in development too", () => {
    expect(authMode(ENFORCED)).toBe("enforced");
    expect(authMode({ ...ENFORCED, NODE_ENV: "development" })).toBe("enforced");
  });

  it("is open only when AUTH_OPEN=1 is set and neither credential is", () => {
    expect(authMode(OPEN)).toBe("open");
    expect(authMode({ AUTH_OPEN: "1" })).toBe("open");
  });

  it("is NOT open just because NODE_ENV is not production — `next start` never sets it", () => {
    // The regression this flag exists for: a production build launched from a
    // shell carrying NODE_ENV=development used to serve the whole site with no
    // login at all.
    expect(authMode({ NODE_ENV: "development" })).toBe("closed");
    expect(authMode({ NODE_ENV: "test" })).toBe("closed");
    expect(authMode({})).toBe("closed");
  });

  it("takes AUTH_OPEN=1 and nothing else as the flag", () => {
    for (const AUTH_OPEN of ["", "0", "true", "yes", "on"]) {
      expect(authMode({ AUTH_OPEN }), AUTH_OPEN).toBe("closed");
    }
  });

  it("fails closed in production when they are missing", () => {
    expect(authMode(PROD_UNSET)).toBe("closed");
  });

  it("never lets the flag downgrade a configured server", () => {
    expect(authMode({ ...ENFORCED, AUTH_OPEN: "1" })).toBe("enforced");
    expect(authMode({ OWNER_PASSWORD: "hunter2", AUTH_OPEN: "1" })).toBe("closed");
  });

  it("fails closed when only half of it is configured, whatever the environment", () => {
    expect(authMode({ NODE_ENV: "development", OWNER_PASSWORD: "hunter2" })).toBe("closed");
    expect(authMode({ NODE_ENV: "development", AUTH_SECRET: "key" })).toBe("closed");
  });

  it("treats blank values as unset", () => {
    expect(authMode({ NODE_ENV: "production", OWNER_PASSWORD: "  ", AUTH_SECRET: "  " })).toBe("closed");
  });

});

describe("the session cookie", () => {
  it("verifies a value it just signed", async () => {
    const value = await signSession(Date.now() + 60_000, ENFORCED);
    expect(await verifySession(value, ENFORCED)).toBe(true);
  });

  it("carries the expiry and nothing else", async () => {
    const expiresAt = Date.now() + 60_000;
    const [payload] = (await signSession(expiresAt, ENFORCED)).split(".");
    expect(atob(payload.replace(/-/g, "+").replace(/_/g, "/"))).toBe(String(expiresAt));
  });

  it("rejects an expired cookie", async () => {
    const value = await signSession(Date.now() + 1000, ENFORCED);
    expect(await verifySession(value, ENFORCED, Date.now() + 2000)).toBe(false);
  });

  it("rejects a tampered expiry", async () => {
    const value = await signSession(Date.now() - 1000, ENFORCED);
    const [, signature] = value.split(".");
    const forged = `${btoa(String(Date.now() + 86_400_000)).replace(/=+$/, "")}.${signature}`;
    expect(await verifySession(forged, ENFORCED)).toBe(false);
  });

  it("rejects a tampered signature", async () => {
    const value = await signSession(Date.now() + 60_000, ENFORCED);
    const [payload, signature] = value.split(".");
    expect(await verifySession(`${payload}.${signature.slice(0, -1)}x`, ENFORCED)).toBe(false);
  });

  it("rejects a cookie signed with another secret", async () => {
    const value = await signSession(Date.now() + 60_000, { ...ENFORCED, AUTH_SECRET: "someone else's key" });
    expect(await verifySession(value, ENFORCED)).toBe(false);
  });

  it("rejects rubbish, an empty value and a missing one", async () => {
    for (const bad of ["", "nonsense", "a.b.c", "..", undefined, null]) {
      expect(await verifySession(bad, ENFORCED)).toBe(false);
    }
  });

  it("cannot be verified at all with no secret configured", async () => {
    const value = await signSession(Date.now() + 60_000, ENFORCED);
    expect(await verifySession(value, PROD_UNSET)).toBe(false);
    await expect(signSession(Date.now(), PROD_UNSET)).rejects.toThrow(/AUTH_SECRET/);
  });
});

describe("bearer tokens", () => {
  it("parses name:token pairs, trimming whitespace", () => {
    expect(parseApiTokens("phone:tok-phone, importer:tok-import")).toEqual([
      { name: "phone", token: "tok-phone" },
      { name: "importer", token: "tok-import" },
    ]);
  });

  it("accepts a bare token and keeps colons inside one", () => {
    expect(parseApiTokens("plain-token")).toEqual([{ name: "", token: "plain-token" }]);
    expect(parseApiTokens("phone:abc:def")).toEqual([{ name: "phone", token: "abc:def" }]);
  });

  it("ignores empty entries and a missing variable", () => {
    expect(parseApiTokens(" , ,phone:x, ")).toEqual([{ name: "phone", token: "x" }]);
    expect(parseApiTokens(undefined)).toEqual([]);
    expect(parseApiTokens("name:")).toEqual([]);
  });

  it("reads the header case-insensitively", () => {
    expect(bearerToken("Bearer abc")).toBe("abc");
    expect(bearerToken("bearer  abc ")).toBe("abc");
    expect(bearerToken("Basic abc")).toBe(null);
    expect(bearerToken(null)).toBe(null);
  });

  it("matches any configured token and nothing else", () => {
    expect(matchesApiToken("Bearer tok-phone", ENFORCED)).toBe(true);
    expect(matchesApiToken("Bearer tok-import", ENFORCED)).toBe(true);
    expect(matchesApiToken("Bearer tok-phon", ENFORCED)).toBe(false);
    expect(matchesApiToken("Bearer tok-phonex", ENFORCED)).toBe(false);
    expect(matchesApiToken("Bearer ", ENFORCED)).toBe(false);
    expect(matchesApiToken(undefined, ENFORCED)).toBe(false);
    expect(matchesApiToken("Bearer anything", { ...ENFORCED, API_TOKENS: undefined })).toBe(false);
  });
});

describe("safeEqual", () => {
  it("compares without leaking on length", () => {
    expect(safeEqual("abc", "abc")).toBe(true);
    expect(safeEqual("abc", "abd")).toBe(false);
    expect(safeEqual("abc", "ab")).toBe(false);
    expect(safeEqual("ab", "abc")).toBe(false);
    // Two empty strings are not a match: nothing an attacker sends should
    // authenticate by being as absent as whatever it is compared against.
    expect(safeEqual("", "")).toBe(false);
    expect(safeEqual("", "a")).toBe(false);
    expect(safeEqual("a", "")).toBe(false);
    // A repeated prefix must not fold to equal under the modulo indexing.
    expect(safeEqual("abcabc", "abc")).toBe(false);
  });
});

describe("checkOwnerPassword", () => {
  it("accepts the password and rejects near misses", () => {
    expect(checkOwnerPassword("hunter2", ENFORCED)).toBe(true);
    expect(checkOwnerPassword("hunter", ENFORCED)).toBe(false);
    expect(checkOwnerPassword("hunter22", ENFORCED)).toBe(false);
    expect(checkOwnerPassword("", ENFORCED)).toBe(false);
  });

  it("never lets anyone in when auth is not configured", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(checkOwnerPassword("", OPEN)).toBe(false);
    expect(checkOwnerPassword("anything", PROD_UNSET)).toBe(false);
  });
});

describe("isOwnerSession — what a page sees", () => {
  it("is true for everyone when nothing is configured in development", async () => {
    expect(await isOwnerSession(undefined, OPEN)).toBe(true);
  });

  it("is false for everyone when production is misconfigured, and says so once", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const value = await signSession(Date.now() + 60_000, ENFORCED);
    expect(await isOwnerSession(value, PROD_UNSET)).toBe(false);
    expect(await isOwnerSession(undefined, PROD_UNSET)).toBe(false);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toMatch(/OWNER_PASSWORD and AUTH_SECRET/);
  });

  it("needs a valid cookie once auth is enforced", async () => {
    expect(await isOwnerSession(undefined, ENFORCED)).toBe(false);
    expect(await isOwnerSession(await signSession(Date.now() + 60_000, ENFORCED), ENFORCED)).toBe(true);
  });
});

describe("isOwnerRequest — what src/proxy.ts sees", () => {
  it("takes either credential", async () => {
    const value = await signSession(Date.now() + 60_000, ENFORCED);
    expect(await isOwnerRequest(req({ cookie: `${SESSION_COOKIE}=${value}` }), ENFORCED)).toBe(true);
    expect(await isOwnerRequest(req({ authorization: "Bearer tok-import" }), ENFORCED)).toBe(true);
  });

  it("refuses a request with neither, a wrong token, or an expired cookie", async () => {
    const stale = await signSession(Date.now() - 1, ENFORCED);
    expect(await isOwnerRequest(req(), ENFORCED)).toBe(false);
    expect(await isOwnerRequest(req({ authorization: "Bearer nope" }), ENFORCED)).toBe(false);
    expect(await isOwnerRequest(req({ cookie: `${SESSION_COOKIE}=${stale}` }), ENFORCED)).toBe(false);
    expect(await isOwnerRequest(req({ cookie: `${SESSION_COOKIE}=forged.value` }), ENFORCED)).toBe(false);
  });

  it("finds the cookie among others", async () => {
    const value = await signSession(Date.now() + 60_000, ENFORCED);
    expect(await isOwnerRequest(req({ cookie: `theme=dark; ${SESSION_COOKIE}=${value}; other=1` }), ENFORCED)).toBe(true);
  });

  it("is open with AUTH_OPEN=1 and closed in a misconfigured production, whatever is presented", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(await isOwnerRequest(req(), OPEN)).toBe(true);
    expect(await isOwnerRequest(req({ authorization: "Bearer tok-phone" }), PROD_UNSET)).toBe(false);
  });

  it("takes the session under either cookie name, preferring the __Host- one", async () => {
    const good = await signSession(Date.now() + 60_000, ENFORCED);
    const forged = "forged.value";
    expect(await isOwnerRequest(req({ cookie: `${SECURE_SESSION_COOKIE}=${good}` }), ENFORCED)).toBe(true);
    // A cookie a subdomain could have written must not win over the prefixed one.
    expect(await isOwnerRequest(req({ cookie: `${SESSION_COOKIE}=${good}; ${SECURE_SESSION_COOKIE}=${forged}` }), ENFORCED)).toBe(false);
  });
});

describe("isOwnerPage — which pages src/proxy.ts sends to /login", () => {
  it("gates the curation tools", () => {
    expect(isOwnerPage("/import")).toBe(true);
    expect(isOwnerPage("/import/abc123")).toBe(true);
    expect(isOwnerPage("/series/new")).toBe(true);
    expect(isOwnerPage("/series/final-fantasy/edit")).toBe(true);
    // The slug is attacker-shaped text, not a known value — anything that is
    // one path segment ending in /edit is the editor.
    expect(isOwnerPage("/series/e2e-desktop-series/edit")).toBe(true);
    expect(isOwnerPage("/series/x/edit")).toBe(true);
  });

  it("leaves every reading page public — a series included", () => {
    // The regression this guards: `/series/:slug` behind a login would put the
    // one page a link is *for* behind a password. The Edit control on it is
    // drawn from `canEdit`, which is a different mechanism entirely.
    for (const p of ["/", "/shelf", "/flip", "/playing", "/series", "/series/final-fantasy", "/game/abc123", "/login"]) {
      expect(isOwnerPage(p), p).toBe(false);
    }
  });

  it("does not over-reach past the one segment and the /edit at the end", () => {
    for (const p of ["/series/a/b/edit", "/series/edit", "/series/final-fantasy/editor", "/series/final-fantasy/edit/extra", "/seriesx/final-fantasy/edit", "/x/series/final-fantasy/edit"]) {
      expect(isOwnerPage(p), p).toBe(false);
    }
  });
});

describe("small helpers", () => {
  it("reads one cookie out of a header", () => {
    expect(cookieFromHeader("a=1; gx_session=xyz", SESSION_COOKIE)).toBe("xyz");
    expect(cookieFromHeader("a=1", SESSION_COOKIE)).toBeUndefined();
    expect(cookieFromHeader(null, SESSION_COOKIE)).toBeUndefined();
    expect(cookieFromHeader("gx_session_other=no", SESSION_COOKIE)).toBeUndefined();
  });

  it("only marks the cookie Secure when the request really came over https", () => {
    expect(isSecureRequest(new Request("http://localhost:3000/", { headers: { "x-forwarded-proto": "https" } }))).toBe(true);
    expect(isSecureRequest(new Request("http://localhost:3000/", { headers: { "x-forwarded-proto": "https,http" } }))).toBe(true);
    expect(isSecureRequest(new Request("http://localhost:3000/"))).toBe(false);
    expect(isSecureRequest(new Request("https://games.example.com/"))).toBe(true);
  });

  it("names the cookie __Host- only where Secure is allowed", () => {
    expect(sessionCookieName(true)).toBe("__Host-gx_session");
    expect(sessionCookieName(false)).toBe("gx_session");
    expect(sessionFromCookieHeader(`${SESSION_COOKIE}=plain`)).toBe("plain");
    expect(sessionFromCookieHeader(`${SECURE_SESSION_COOKIE}=host; ${SESSION_COOKIE}=plain`)).toBe("host");
    expect(sessionFromCookieHeader(undefined)).toBeUndefined();
  });

  it("shows only login errors it knows, never the query string's own text", () => {
    expect(loginErrorMessage("wrong-password")).toBe("wrong password");
    expect(loginErrorMessage("not-configured")).toBe("auth is not configured on this server");
    expect(loginErrorMessage("Your account is locked. Call 555-0100 to restore it.")).toBeNull();
    expect(loginErrorMessage("toString")).toBeNull();
    expect(loginErrorMessage(undefined)).toBeNull();
  });

  it("keeps a redirect target on this site", () => {
    expect(safeNext("/import")).toBe("/import");
    expect(safeNext("/import/abc")).toBe("/import/abc");
    expect(safeNext("/series/new")).toBe("/series/new");
    expect(safeNext("/game/abc?x=1")).toBe("/game/abc?x=1");
  });

  it("refuses a redirect target that leaves the site", () => {
    for (const bad of [
      // One slash, and every browser still resolves it to https://evil.example/.
      "/\\evil.example",
      "/\\\\evil.example",
      "//evil.example/x",
      "https://evil.example",
      "http:/\\/\\evil.example",
      "javascript:alert(1)",
      "data:text/html,<script>alert(1)</script>",
      "\\\\evil.example\\x",
      "/import\\evil",
      // A newline in a Location: header is a header-injection attempt.
      "/import\r\nX-Injected: 1",
      "/import\nX-Injected: 1",
      "/import\u0000",
      "import",
      "",
      " /import",
    ]) {
      expect(safeNext(bad), JSON.stringify(bad)).toBe("/");
    }
    expect(safeNext(undefined)).toBe("/");
    expect(safeNext(42)).toBe("/");
    expect(safeNext(null)).toBe("/");
    expect(safeNext({ toString: () => "/import" })).toBe("/");
  });
});
