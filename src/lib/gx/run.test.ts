import { describe, expect, it, vi } from "vitest";
import type { Io } from "./client";
import { TOKEN_VAR, URL_VAR } from "./env";
import { COMMANDS } from "./registry";
import { run } from "./run";

/**
 * The CLI end to end, with a fake `fetch`.
 *
 * Nothing here touches a network, a database or the real environment — `run`
 * takes its whole world as an `Io`, which is the point of it returning an exit
 * code instead of calling `process.exit`. What these tests pin down is the
 * contract an agent actually depends on: which stream the output lands on,
 * what the exit code means, and that a write announces its target before it
 * happens.
 */

const ENV = { [URL_VAR]: "https://games.example.com", [TOKEN_VAR]: "tok" };

/** The stderr line every mutating command prints before it writes. */
const ARROW = "→";

type Harness = { io: Io; out: string[]; err: string[]; calls: { url: string; init: RequestInit & { duplex?: string } }[] };

/** An `Io` that records everything and answers every request with `body`. */
function harness(response: { status?: number; body?: unknown; text?: string; contentType?: string } = {}, env: Record<string, string | undefined> = ENV, stdin = ""): Harness {
  const out: string[] = [];
  const err: string[] = [];
  const calls: Harness["calls"] = [];
  const status = response.status ?? 200;
  const text = response.text ?? JSON.stringify(response.body ?? { ok: true });

  const fakeFetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: (init ?? {}) as RequestInit });
    return new Response(text, { status, headers: { "content-type": response.contentType ?? "application/json" } });
  }) as unknown as typeof fetch;

  return {
    out,
    err,
    calls,
    io: {
      fetch: fakeFetch,
      env,
      out: (t) => out.push(t),
      err: (t) => err.push(t),
      outBytes: (b) => out.push(`<${b.byteLength} bytes>`),
      readStdin: async () => stdin,
    },
  };
}

describe("help", () => {
  it("`gx --help` lists the groups and exits 0", async () => {
    const h = harness();
    expect(await run(["--help"], h.io)).toBe(0);
    expect(h.out.join("")).toContain("Command groups:");
    expect(h.out.join("")).toContain("bookmarks");
    expect(h.calls).toHaveLength(0);
  });

  it("a bare `gx` prints the same top-level help rather than an error", async () => {
    const h = harness();
    expect(await run([], h.io)).toBe(0);
    expect(h.out.join("")).toContain("the Game Explorer agent CLI");
  });

  it("`gx <group>` and `gx <group> --help` both list that group's commands", async () => {
    for (const argv of [["codes"], ["codes", "--help"]]) {
      const h = harness();
      expect(await run(argv, h.io)).toBe(0);
      expect(h.out.join("")).toContain("gaps");
      // The usage line comes from the registry's `args`, so a command that
      // grows an argument grows one here without anyone editing prose.
      expect(h.out.join("")).toContain("update <ownedGameId> <codeId>");
    }
  });

  it("`gx <group> <cmd> --help` shows the args, the flags and the route it calls", async () => {
    const h = harness();
    expect(await run(["games", "search", "--help"], h.io)).toBe(0);
    const text = h.out.join("");
    expect(text).toContain("Usage:  gx games search [query] [flags]");
    expect(text).toContain("--platform");
    expect(text).toContain("Calls:  GET /api/games");
  });

  it("help works with no environment at all — you can read the docs before you have a token", async () => {
    const h = harness({}, {});
    expect(await run(["codes", "add", "--help"], h.io)).toBe(0);
    expect(h.err.join("")).toBe("");
  });

  it("every command's help renders, and names its own route", async () => {
    // Cheap insurance for a table of eighty entries: a missing summary or a
    // malformed flag shows up here rather than the first time someone asks.
    for (const cmd of COMMANDS) {
      const h = harness({}, {});
      expect(await run([cmd.group, cmd.name, "--help"], h.io)).toBe(0);
      expect(h.out.join("")).toContain(`Calls:  ${cmd.method} ${cmd.route}`);
    }
  });
});

describe("usage errors (exit 2)", () => {
  it("an unknown group is 2, with a suggestion", async () => {
    const h = harness();
    expect(await run(["code", "list", "x"], h.io)).toBe(2);
    expect(h.err.join("")).toContain("Did you mean `codes`?");
    expect(h.calls).toHaveLength(0);
  });

  it("an unknown command inside a real group is 2", async () => {
    const h = harness();
    expect(await run(["codes", "delete", "x"], h.io)).toBe(2);
    expect(h.err.join("")).toMatch(/has no command "delete"/);
  });

  it("a missing required argument is 2 and never reaches the network", async () => {
    const h = harness();
    expect(await run(["games", "show"], h.io)).toBe(2);
    expect(h.err.join("")).toContain("missing <ownedGameId>");
    expect(h.calls).toHaveLength(0);
  });

  it("a missing required flag is 2", async () => {
    const h = harness();
    expect(await run(["codes", "add", "abc", "--effect", "Infinite lives"], h.io)).toBe(2);
    expect(h.err.join("")).toContain("--kind is required");
  });

  it("a value outside a flag's choices is 2, listing them", async () => {
    const h = harness();
    expect(await run(["codes", "add", "abc", "--kind", "gameshark", "--effect", "x"], h.io)).toBe(2);
    expect(h.err.join("")).toContain("password, cheat, game-genie, action-replay");
  });

  it("an unknown flag is 2 rather than being silently ignored", async () => {
    const h = harness();
    expect(await run(["games", "search", "sonic", "--platfrom", "nes"], h.io)).toBe(2);
    expect(h.err.join("")).toContain("unknown flag --platfrom");
  });

  it("a non-numeric value for an int flag is 2", async () => {
    const h = harness();
    expect(await run(["games", "search", "--limit", "lots"], h.io)).toBe(2);
    expect(h.err.join("")).toContain("wants a whole number");
  });

  it("too many positionals is 2 — a stray id must not be dropped", async () => {
    const h = harness();
    expect(await run(["games", "show", "abc", "def"], h.io)).toBe(2);
    expect(h.err.join("")).toContain("too many arguments");
  });

  it("an unset environment variable is 2, after parsing, with nothing sent", async () => {
    const h = harness({}, { [TOKEN_VAR]: "tok" });
    expect(await run(["games", "search", "sonic"], h.io)).toBe(2);
    expect(h.err.join("")).toContain(`${URL_VAR} is not set`);
    expect(h.calls).toHaveLength(0);
  });

  it("a localhost target is 2 without --dev and 0 with it", async () => {
    const local = { ...ENV, [URL_VAR]: "http://localhost:3000" };
    const refused = harness({}, local);
    expect(await run(["games", "search", "sonic"], refused.io)).toBe(2);
    expect(refused.err.join("")).toContain("that is this machine");
    expect(refused.calls).toHaveLength(0);

    const allowed = harness({ body: { games: [] } }, local);
    expect(await run(["games", "search", "sonic", "--dev"], allowed.io)).toBe(0);
    expect(allowed.calls[0].url).toBe("http://localhost:3000/api/games?q=sonic");
  });
});

describe("requests", () => {
  it("fills path parameters, in order, and url-encodes them", async () => {
    const h = harness({ body: { ok: true } });
    expect(await run(["codes", "remove", "game/1", "code 2"], h.io)).toBe(0);
    expect(h.calls[0].url).toBe("https://games.example.com/api/games/game%2F1/codes/code%202");
    expect(h.calls[0].init.method).toBe("DELETE");
  });

  it("repeats a repeatable query flag instead of collapsing it", async () => {
    const h = harness({ body: { games: [] } });
    await run(["games", "search", "sonic", "--platform", "nes", "--platform", "snes", "--limit=10"], h.io);
    expect(h.calls[0].url).toBe("https://games.example.com/api/games?q=sonic&platform=nes&platform=snes&limit=10");
  });

  it("builds a JSON body from named flags, converting types", async () => {
    const h = harness({ body: { id: "c1" } });
    await run(["codes", "add", "g1", "--kind", "game-genie", "--effect", "Infinite lives", "--code", "SXIOPO", "--position", "3", "--verified"], h.io);
    expect(JSON.parse(String(h.calls[0].init.body))).toEqual({ kind: "game-genie", effect: "Infinite lives", code: "SXIOPO", position: 3, verified: true });
    expect((h.calls[0].init.headers as Record<string, string>)["content-type"]).toBe("application/json");
  });

  it("sends the bearer token on every call", async () => {
    const h = harness({ body: { tags: [] } });
    await run(["tags", "list"], h.io);
    expect((h.calls[0].init.headers as Record<string, string>).authorization).toBe("Bearer tok");
  });

  it("`--no-<flag>` sets a boolean false", async () => {
    const h = harness({ body: { ok: true } });
    await run(["import", "commit", "s1", "--no-force"], h.io);
    expect(JSON.parse(String(h.calls[0].init.body))).toEqual({ force: false });
  });

  it("a `json` flag keeps false and null distinct from a string", async () => {
    // `--value 0` and `--value false` are two different facts about a game.
    const h = harness({ body: { ok: true } });
    await run(["facts", "set", "g1", "--field", "simultaneousPlay", "--value", "false"], h.io);
    expect(JSON.parse(String(h.calls[0].init.body))).toEqual({ field: "simultaneousPlay", value: false });

    const h2 = harness({ body: { ok: true } });
    await run(["games", "update", "g1", "--igdb-id", "null"], h2.io);
    expect(JSON.parse(String(h2.calls[0].init.body))).toEqual({ igdbId: null });
  });

  it("`--body` supplies the whole body and named flags merge on top of it", async () => {
    const h = harness({ body: { written: [] } });
    await run(["maps", "markers", "m1", "--body", '{"markers":[{"name":"Baron","kind":"castle","x":1,"y":2}]}', "--replace"], h.io);
    expect(JSON.parse(String(h.calls[0].init.body))).toEqual({ markers: [{ name: "Baron", kind: "castle", x: 1, y: 2 }], replace: true });
  });

  it("`--body -` reads the batch from stdin", async () => {
    const h = harness({ body: { written: [], skipped: [] } }, ENV, '{"codes":[{"ownedGameId":"g1","kind":"cheat","effect":"30 lives"}]}');
    expect(await run(["codes", "write", "--body", "-"], h.io)).toBe(0);
    expect(JSON.parse(String(h.calls[0].init.body))).toEqual({ codes: [{ ownedGameId: "g1", kind: "cheat", effect: "30 lives" }] });
  });

  it("a `--body` excuses a required flag it may itself carry", async () => {
    const h = harness({ body: { id: "s1" } });
    expect(await run(["series", "create", "--body", '{"name":"Final Fantasy","entries":[]}'], h.io)).toBe(0);
  });

  it("a repeatable body flag collects into the array the route wants", async () => {
    const h = harness({ body: { ok: true } });
    await run(["manuals", "reorder", "m1", "--page", "p1", "--page", "p2", "--page", "p3"], h.io);
    expect(JSON.parse(String(h.calls[0].init.body))).toEqual({ orderedIds: ["p1", "p2", "p3"] });
  });

  it("sends no body for a route that parses none", async () => {
    const h = harness({ body: { factsWritten: 0 } });
    await run(["enrichment", "finish", "r1"], h.io);
    expect(h.calls[0].init.body).toBeUndefined();
  });

  it("malformed JSON in --body is a usage error, not a request", async () => {
    const h = harness();
    expect(await run(["codes", "write", "--body", "{oops}"], h.io)).toBe(2);
    expect(h.calls).toHaveLength(0);
  });
});

describe("output and exit codes", () => {
  it("--json prints the API's bytes verbatim and nothing else on stdout", async () => {
    const body = '{"games":[{"ownedGameId":"g1","name":"Sonic the Hedgehog 2"}],"nextCursor":null}';
    const h = harness({ text: body });
    expect(await run(["games", "search", "sonic", "--json"], h.io)).toBe(0);
    expect(h.out.join("")).toBe(`${body}\n`);
  });

  it("the default output is human-readable and shows the rows", async () => {
    const h = harness({ body: { games: [{ ownedGameId: "g1", name: "Sonic the Hedgehog 2", platform: "genesis" }], nextCursor: null } });
    await run(["games", "search", "sonic"], h.io);
    const text = h.out.join("");
    expect(text).toContain("games (1)");
    expect(text).toContain("Sonic the Hedgehog 2");
    expect(text).toContain("nextCursor");
  });

  it("a 4xx exits 1 with the API's own message on stderr, verbatim", async () => {
    const h = harness({ status: 409, text: '{"error":"a copy of that title is already on the shelf for that platform"}' });
    expect(await run(["games", "update", "g1", "--platform", "snes"], h.io)).toBe(1);
    expect(h.err.join("")).toContain("409 a copy of that title is already on the shelf for that platform");
    expect(h.out.join("")).toBe("");
  });

  it("a 400 prints the API's `details` so a batch's bad rows are findable", async () => {
    const h = harness({ status: 400, text: '{"error":"invalid input","details":[{"path":["bookmarks",3,"why"]}]}' });
    expect(await run(["bookmarks", "write", "--body", '{"bookmarks":[]}'], h.io)).toBe(1);
    expect(h.err.join("")).toContain('"path"');
  });

  it("a 401 is printed and never retried", async () => {
    const h = harness({ status: 401, text: '{"error":"unauthorized"}' });
    expect(await run(["tags", "list"], h.io)).toBe(1);
    expect(h.calls).toHaveLength(1);
    expect(h.err.join("")).toContain("401 unauthorized");
  });

  it("a non-JSON, non-HTML error body is surfaced verbatim rather than swallowed", async () => {
    const h = harness({ status: 502, text: "upstream connect error", contentType: "text/plain" });
    expect(await run(["tags", "list"], h.io)).toBe(1);
    expect(h.err.join("")).toContain("502 upstream connect error");
  });

  it("an HTML 404 is read as a missing route, not printed as a page", async () => {
    // The real case: the mini is on an older build than the checkout, so a
    // route that exists here does not exist there and Next answers with two
    // kilobytes of its own 404 page. The version hint is the useful part; the
    // markup is not.
    const page = `<!DOCTYPE html><html><head>${"<script></script>".repeat(200)}</head><body>404</body></html>`;
    const h = harness({ status: 404, text: page, contentType: "text/html; charset=utf-8" });
    expect(await run(["games", "search", "sonic"], h.io)).toBe(1);
    const printed = h.err.join("");
    expect(printed).toContain("that route is not on this server");
    expect(printed).toContain("older build");
    expect(printed).not.toContain("<script>");
    expect(printed.length).toBeLessThan(400);
  });

  it("a network failure is a usage error — nothing answered, so nothing was written", async () => {
    const h = harness();
    h.io.fetch = (async () => {
      throw new TypeError("fetch failed");
    }) as unknown as typeof fetch;
    expect(await run(["tags", "list"], h.io)).toBe(2);
    expect(h.err.join("")).toContain("could not reach https://games.example.com/api/tags");
  });
});

describe("the write announcement", () => {
  it("every mutating command prints the method and full url to stderr", async () => {
    const h = harness({ body: { ok: true } });
    await run(["codes", "add", "g1", "--kind", "cheat", "--effect", "30 lives"], h.io);
    expect(h.err[0]).toBe(`${ARROW} POST https://games.example.com/api/games/g1/codes\n`);
  });

  it("it happens before the request, so an interrupted write still named its host", async () => {
    const h = harness({ body: { ok: true } });
    const seen: string[] = [];
    h.io.fetch = (async () => {
      seen.push(...h.err);
      return new Response('{"ok":true}', { status: 200, headers: { "content-type": "application/json" } });
    }) as unknown as typeof fetch;
    await run(["games", "remove", "g1"], h.io);
    expect(seen.join("")).toContain(`${ARROW} DELETE https://games.example.com/api/games/g1`);
  });

  it("a read announces nothing — stderr stays empty on the happy path", async () => {
    const h = harness({ body: { tags: [] } });
    await run(["tags", "list"], h.io);
    expect(h.err.join("")).toBe("");
  });

  it("the token never appears in anything printed", async () => {
    const h = harness({ body: { ok: true } });
    await run(["codes", "add", "g1", "--kind", "cheat", "--effect", "30 lives"], h.io);
    expect([...h.out, ...h.err].join("")).not.toContain("tok");
  });
});

describe("binary reads and uploads", () => {
  it("a binary read summarises by default and writes bytes with --raw", async () => {
    const summary = harness({ text: "PNG-ish", contentType: "image/png" });
    expect(await run(["maps", "image", "m1"], summary.io)).toBe(0);
    expect(summary.out.join("")).toContain("image/png");

    const raw = harness({ text: "PNG-ish", contentType: "image/png" });
    expect(await run(["maps", "image", "m1", "--raw"], raw.io)).toBe(0);
    expect(raw.out.join("")).toMatch(/^<\d+ bytes>$/);
  });

  it("an upload streams a real file with a matching content-length", async () => {
    // package.json is a file that certainly exists and whose size the test can
    // check against — the point is that `content-length` is the file's true
    // size, because the route refuses a body shorter than its declared length.
    const { statSync } = await import("node:fs");
    const size = statSync("package.json").size;
    const h = harness({ body: { bytes: size } });
    expect(await run(["music", "upload", "t1", "package.json"], h.io)).toBe(0);
    const headers = h.calls[0].init.headers as Record<string, string>;
    expect(headers["content-length"]).toBe(String(size));
    expect(headers["content-type"]).toBe("audio/mpeg");
    expect(h.calls[0].init.duplex).toBe("half");
  });

  it("an unreadable upload path is a usage error, before anything is sent", async () => {
    const h = harness();
    expect(await run(["music", "upload", "t1", "no/such/file.mp3"], h.io)).toBe(2);
    expect(h.err.join("")).toContain("cannot read no/such/file.mp3");
    expect(h.calls).toHaveLength(0);
  });
});
