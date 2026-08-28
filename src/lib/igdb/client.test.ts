import { describe, expect, it } from "vitest";
import { z } from "zod";
import { IgdbClient, IgdbError } from "./client";

type Call = { url: string; init?: RequestInit };

function fakeFetch(handler: (call: Call, n: number) => Response | Promise<Response>) {
  const calls: Call[] = [];
  const f = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const call = { url: String(input), init };
    calls.push(call);
    return handler(call, calls.length);
  }) as typeof fetch;
  return { fetch: f, calls };
}

const tokenJson = (tok: string, expiresIn = 3600) =>
  new Response(JSON.stringify({ access_token: tok, expires_in: expiresIn, token_type: "bearer" }), { status: 200 });

function makeClient(fetchImpl: typeof fetch, extra: Partial<ConstructorParameters<typeof IgdbClient>[0]> = {}) {
  let t = 1_000_000;
  const sleeps: number[] = [];
  const client = new IgdbClient({
    clientId: "id",
    clientSecret: "secret",
    fetch: fetchImpl,
    now: () => t,
    sleep: async (ms) => {
      sleeps.push(ms);
      t += ms;
    },
    ...extra,
  });
  return { client, sleeps, advance: (ms: number) => (t += ms) };
}

const item = z.object({ id: z.number() });

describe("IgdbClient", () => {
  it("fetches a token once and sends both headers", async () => {
    const { fetch, calls } = fakeFetch((c) =>
      c.url.includes("oauth2") ? tokenJson("abc") : new Response("[{\"id\":1}]", { status: 200 }),
    );
    const { client } = makeClient(fetch);
    await client.query("games", "fields id;", item);
    await client.query("games", "fields id;", item);
    const tokenCalls = calls.filter((c) => c.url.includes("oauth2"));
    expect(tokenCalls).toHaveLength(1);
    expect(new URL(tokenCalls[0].url).searchParams.get("grant_type")).toBe("client_credentials");
    const headers = calls[1].init?.headers as Record<string, string>;
    expect(headers["Client-ID"]).toBe("id");
    expect(headers.Authorization).toBe("Bearer abc");
  });

  it("refreshes the token before it expires", async () => {
    let n = 0;
    const { fetch, calls } = fakeFetch((c) =>
      c.url.includes("oauth2") ? tokenJson(`t${++n}`, 100) : new Response("[]", { status: 200 }),
    );
    const { client, advance } = makeClient(fetch);
    await client.query("games", "fields id;", item);
    advance(50_000); // past expiry minus the 60s safety margin
    await client.query("games", "fields id;", item);
    expect(calls.filter((c) => c.url.includes("oauth2"))).toHaveLength(2);
    expect((calls.at(-1)!.init?.headers as Record<string, string>).Authorization).toBe("Bearer t2");
  });

  it("refreshes the token on a 401 and retries", async () => {
    let n = 0;
    const { fetch, calls } = fakeFetch((c) => {
      if (c.url.includes("oauth2")) return tokenJson(`t${++n}`);
      const auth = (c.init?.headers as Record<string, string>).Authorization;
      return auth === "Bearer t1" ? new Response("expired", { status: 401 }) : new Response("[{\"id\":7}]", { status: 200 });
    });
    const { client } = makeClient(fetch);
    const out = await client.query("games", "fields id;", item);
    expect(out).toEqual([{ id: 7 }]);
    expect(calls.filter((c) => c.url.includes("oauth2"))).toHaveLength(2);
  });

  it("spaces requests to stay under 4 per second", async () => {
    const { fetch } = fakeFetch((c) => (c.url.includes("oauth2") ? tokenJson("t") : new Response("[]", { status: 200 })));
    const { client, sleeps } = makeClient(fetch, { minIntervalMs: 260 });
    await Promise.all([1, 2, 3, 4, 5].map(() => client.query("games", "fields id;", item)));
    // First call needs no wait; each subsequent one waits for its slot.
    expect(sleeps.length).toBeGreaterThanOrEqual(4);
    expect(Math.min(...sleeps)).toBeGreaterThanOrEqual(260);
  });

  it("backs off and retries after a 429", async () => {
    let apiCalls = 0;
    const { fetch } = fakeFetch((c) => {
      if (c.url.includes("oauth2")) return tokenJson("t");
      apiCalls++;
      return apiCalls < 3 ? new Response("Too Many Requests", { status: 429 }) : new Response("[{\"id\":1}]", { status: 200 });
    });
    const { client, sleeps } = makeClient(fetch);
    expect(await client.query("games", "fields id;", item)).toEqual([{ id: 1 }]);
    expect(apiCalls).toBe(3);
    expect(sleeps.some((s) => s >= 500)).toBe(true);
  });

  it("gives up after maxRetries with an IgdbError", async () => {
    const { fetch } = fakeFetch((c) => (c.url.includes("oauth2") ? tokenJson("t") : new Response("nope", { status: 429 })));
    const { client } = makeClient(fetch, { maxRetries: 2 });
    await expect(client.query("games", "fields id;", item)).rejects.toBeInstanceOf(IgdbError);
  });

  it("rejects malformed responses", async () => {
    const { fetch } = fakeFetch((c) => (c.url.includes("oauth2") ? tokenJson("t") : new Response('[{"id":"x"}]', { status: 200 })));
    const { client } = makeClient(fetch);
    await expect(client.query("games", "fields id;", item)).rejects.toThrow();
  });
});
