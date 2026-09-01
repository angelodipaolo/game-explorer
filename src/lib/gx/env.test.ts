import { describe, expect, it } from "vitest";
import { TOKEN_VAR, URL_VAR, UsageError, resolveTarget } from "./env";

/**
 * The guardrails, tested by trying to break them.
 *
 * Every one of these is a specific way the original bug could come back: a
 * variable quietly defaulting, a loopback spelling nobody thought of, a
 * `--dev` that persists past the command it was typed on. If one of these
 * tests is ever "fixed" by adding a fallback to `env.ts`, the fix is wrong.
 */

const REAL = { [URL_VAR]: "http://cids-Mac-mini.local:3000", [TOKEN_VAR]: "tok" };
const prod = { dev: false };
const dev = { dev: true };

describe("resolveTarget", () => {
  it("resolves a real target, canonicalising the host as a URL does", () => {
    // `URL` lowercases the hostname, so the mini's mixed-case mDNS name comes
    // back lowercased. That is fine — DNS is case-insensitive — but it is worth
    // pinning, because it is the difference between the string you exported and
    // the string that shows up in the `→ POST …` line.
    expect(resolveTarget(REAL, prod)).toEqual({ baseUrl: "http://cids-mac-mini.local:3000", token: "tok", isDev: false });
  });

  it("names the missing variable rather than guessing a value", () => {
    expect(() => resolveTarget({ [TOKEN_VAR]: "tok" }, prod)).toThrow(UsageError);
    expect(() => resolveTarget({ [TOKEN_VAR]: "tok" }, prod)).toThrow(new RegExp(`${URL_VAR} is not set`));
    expect(() => resolveTarget({ [URL_VAR]: "https://games.example.com" }, prod)).toThrow(new RegExp(`${TOKEN_VAR} is not set`));
  });

  it("treats an empty or whitespace variable as unset", () => {
    // `export GAME_EXPLORER_URL=` in a shell profile is the realistic version
    // of this, and an empty string that reached `new URL()` would throw
    // something much less useful than "it is not set".
    expect(() => resolveTarget({ ...REAL, [URL_VAR]: "" }, prod)).toThrow(new RegExp(`${URL_VAR} is not set`));
    expect(() => resolveTarget({ ...REAL, [URL_VAR]: "   " }, prod)).toThrow(new RegExp(`${URL_VAR} is not set`));
    expect(() => resolveTarget({ ...REAL, [TOKEN_VAR]: "  " }, prod)).toThrow(new RegExp(`${TOKEN_VAR} is not set`));
  });

  it("has no fallback: an unset URL never resolves to anything", () => {
    // The assertion that matters most in this file. If someone adds
    // `?? "http://localhost:3000"` to env.ts, this is what catches it.
    let resolved: unknown = "not thrown";
    try {
      resolved = resolveTarget({ [TOKEN_VAR]: "tok" }, dev);
    } catch (e) {
      resolved = e;
    }
    expect(resolved).toBeInstanceOf(UsageError);
  });

  it.each(["http://localhost:3000", "http://LOCALHOST:3000", "http://127.0.0.1:3000", "http://127.0.0.2:3000", "http://[::1]:3000", "http://0.0.0.0:3000", "http://api.localhost:3000"])("refuses %s without --dev", (url) => {
    expect(() => resolveTarget({ ...REAL, [URL_VAR]: url }, prod)).toThrow(/refusing to talk to/);
  });

  it.each(["http://localhost:3000", "http://127.0.0.1:3001", "http://[::1]:3000"])("allows %s when --dev is on this invocation", (url) => {
    expect(resolveTarget({ ...REAL, [URL_VAR]: url }, dev).isDev).toBe(true);
  });

  it("does not mistake a real host that merely contains a loopback word", () => {
    // `mylocalhost.example.com` is somebody's server, not this machine.
    expect(() => resolveTarget({ ...REAL, [URL_VAR]: "https://mylocalhost.example.com" }, prod)).not.toThrow();
    expect(() => resolveTarget({ ...REAL, [URL_VAR]: "https://127.0.0.1.example.com" }, prod)).not.toThrow();
  });

  it("refuses a URL it cannot parse, and a scheme it cannot speak", () => {
    expect(() => resolveTarget({ ...REAL, [URL_VAR]: "cids-Mac-mini.local:3000" }, prod)).toThrow(/is not a URL|must be an http/);
    expect(() => resolveTarget({ ...REAL, [URL_VAR]: "file:///Users/angelo/prisma/dev.db" }, prod)).toThrow(/must be an http/);
  });

  it("strips trailing slashes so a path never doubles up", () => {
    expect(resolveTarget({ ...REAL, [URL_VAR]: "https://games.example.com///" }, prod).baseUrl).toBe("https://games.example.com");
  });

  it("keeps a base path, for a server hosted under a prefix", () => {
    expect(resolveTarget({ ...REAL, [URL_VAR]: "https://example.com/games/" }, prod).baseUrl).toBe("https://example.com/games");
  });
});
