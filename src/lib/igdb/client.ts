import { z } from "zod";

/**
 * The only thing in the codebase that talks to IGDB.
 *
 * - Twitch client_credentials token, refreshed before expiry and on a 401.
 * - Requests spaced to stay under 4 req/s; 429s back off and retry.
 */

export type IgdbClientOptions = {
  clientId: string;
  clientSecret: string;
  fetch?: typeof fetch;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  /** Minimum spacing between request starts. 4 req/s => 250ms; 260 leaves slack. */
  minIntervalMs?: number;
  maxRetries?: number;
  baseUrl?: string;
  tokenUrl?: string;
};

export class IgdbError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: string,
  ) {
    super(message);
    this.name = "IgdbError";
  }
}

type Token = { accessToken: string; expiresAt: number };

const tokenResponseSchema = z.object({ access_token: z.string(), expires_in: z.number() });

export class IgdbClient {
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly minIntervalMs: number;
  private readonly maxRetries: number;
  private readonly baseUrl: string;
  private readonly tokenUrl: string;
  private token: Token | null = null;
  private tokenPromise: Promise<Token> | null = null;
  private nextSlot = 0;
  /** Number of HTTP calls made to /v4 (for tests and reports). */
  requestCount = 0;

  constructor(private readonly opts: IgdbClientOptions) {
    this.fetchImpl = opts.fetch ?? globalThis.fetch.bind(globalThis);
    this.now = opts.now ?? (() => Date.now());
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.minIntervalMs = opts.minIntervalMs ?? 260;
    this.maxRetries = opts.maxRetries ?? 5;
    this.baseUrl = opts.baseUrl ?? "https://api.igdb.com/v4";
    this.tokenUrl = opts.tokenUrl ?? "https://id.twitch.tv/oauth2/token";
  }

  /** Reserve the next send slot so calls never exceed the rate limit. */
  private async throttle(): Promise<void> {
    const now = this.now();
    const at = Math.max(now, this.nextSlot);
    this.nextSlot = at + this.minIntervalMs;
    if (at > now) await this.sleep(at - now);
  }

  private async getToken(force = false): Promise<Token> {
    if (!force && this.token && this.token.expiresAt - 60_000 > this.now()) return this.token;
    if (!this.tokenPromise) {
      this.tokenPromise = this.fetchToken().finally(() => {
        this.tokenPromise = null;
      });
    }
    return this.tokenPromise;
  }

  private async fetchToken(): Promise<Token> {
    const url = new URL(this.tokenUrl);
    url.searchParams.set("client_id", this.opts.clientId);
    url.searchParams.set("client_secret", this.opts.clientSecret);
    url.searchParams.set("grant_type", "client_credentials");
    const res = await this.fetchImpl(url, { method: "POST" });
    const text = await res.text();
    if (!res.ok) throw new IgdbError(`Twitch token request failed (${res.status})`, res.status, text);
    const parsed = tokenResponseSchema.parse(JSON.parse(text));
    this.token = {
      accessToken: parsed.access_token,
      expiresAt: this.now() + parsed.expires_in * 1000,
    };
    return this.token;
  }

  /** POST an APIcalypse body to an endpoint and validate the array response. */
  async query<T>(endpoint: string, body: string, itemSchema: z.ZodType<T>): Promise<T[]> {
    let refreshed = false;
    for (let attempt = 0; ; attempt++) {
      const token = await this.getToken(refreshed);
      refreshed = false;
      await this.throttle();
      this.requestCount++;
      const res = await this.fetchImpl(`${this.baseUrl}/${endpoint}`, {
        method: "POST",
        headers: {
          "Client-ID": this.opts.clientId,
          Authorization: `Bearer ${token.accessToken}`,
          Accept: "application/json",
        },
        body,
      });
      const text = await res.text();
      if (res.ok) {
        const json: unknown = JSON.parse(text);
        return z.array(itemSchema).parse(json);
      }
      const retryable = res.status === 429 || res.status >= 500;
      if (res.status === 401 && attempt < this.maxRetries) {
        refreshed = true;
        continue;
      }
      if (retryable && attempt < this.maxRetries) {
        const backoff = Math.min(8000, 500 * 2 ** attempt);
        await this.sleep(backoff);
        continue;
      }
      throw new IgdbError(`IGDB ${endpoint} failed (${res.status}): ${text.slice(0, 200)}`, res.status, text);
    }
  }
}

let singleton: IgdbClient | null = null;

/** Process-wide client built from env. Throws if credentials are missing. */
export function getIgdbClient(): IgdbClient {
  if (singleton) return singleton;
  const clientId = process.env.IGDB_CLIENT_ID;
  const clientSecret = process.env.IGDB_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error("IGDB_CLIENT_ID and IGDB_CLIENT_SECRET must be set in .env");
  }
  singleton = new IgdbClient({ clientId, clientSecret });
  return singleton;
}
