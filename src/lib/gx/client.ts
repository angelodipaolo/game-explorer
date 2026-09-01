import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";
import { UsageError, type Target } from "./env";

/**
 * The one place `gx` talks to the network (GAMEEXPLOR-0036).
 *
 * Deliberately small. It is not a client library — it does not model
 * resources, it does not know what a code or a series is, and it has no
 * per-endpoint methods. It takes a method, a path, a query and a body, and
 * hands back either the response or an `ApiError`. Everything that knows
 * *which* path is in `registry.ts`; everything that knows how to say it in
 * English is in `output.ts`.
 *
 * Three properties are load-bearing and each one is here rather than in the
 * caller so it cannot be skipped by a new command:
 *
 * 1. **The API's `error` string is surfaced verbatim.** Every route in this
 *    app answers a failure with `{ error, details }` (`src/lib/enrichment/http.ts`),
 *    and those messages were written to be read by whoever caused them:
 *    "already at the 30-code limit", "set by hand; agents never overwrite
 *    manual facts", `unknown platform "nintendo 65" — see src/lib/platforms.ts`.
 *    Rewording them here would replace a specific, actionable sentence with a
 *    generic one, so we print theirs and add nothing to it.
 * 2. **There are no retries. At all.** The decision record says "never retry a
 *    401", and the honest way to guarantee that is to have no retry loop for a
 *    401 to be missed by. A 401 from this API means the token is missing or
 *    wrong; retrying it produces a second 401 and a slower failure. If a retry
 *    is ever wanted for a 5xx or a dropped connection, it goes *around* this
 *    function with an explicit status allowlist — not inside it.
 * 3. **Every mutating call announces its target on stderr before it writes.**
 *    `→ POST http://cids-Mac-mini.local:3000/api/games/xyz/codes`. It lives
 *    here, not in `run.ts`, because "the author of the next command remembers
 *    to print the host" is exactly the kind of rule that decays. stderr, not
 *    stdout, so `--json` output stays a clean pipe.
 */

/** A 4xx or 5xx. `run.ts` turns this into exit code 1 with `message` on stderr. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    /** The `details` field when the API sent one — Zod issues, usually. */
    readonly details: unknown = null,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/**
 * Everything the CLI touches that is not pure computation, in one injectable
 * bag. Tests pass a fake `fetch` and string sinks; nothing in `src/lib/gx`
 * reaches for `globalThis.fetch`, `process.stdout` or `process.env` directly,
 * which is what keeps the unit tests off the network and out of the
 * environment they happen to be running in.
 */
export type Io = {
  fetch: typeof fetch;
  env: Record<string, string | undefined>;
  out(text: string): void;
  err(text: string): void;
  /** Raw bytes to stdout, for `--raw` on the three image/audio reads. */
  outBytes(bytes: Uint8Array): void;
  /** Everything piped in, for `--body -`. Reads stdin exactly once. */
  readStdin(): Promise<string>;
};

/** One HTTP call, described by the registry entry and the parsed argv. */
export type ApiRequest = {
  method: string;
  /** The concrete path, `[id]` already substituted: `/api/games/abc/codes`. */
  path: string;
  query?: [string, string][];
  /** A JSON body. Mutually exclusive with `upload`. */
  body?: unknown;
  /** A local file to stream as the raw request body. Mutually exclusive with `body`. */
  upload?: { filePath: string; contentType: string };
  /** `bytes` keeps the response as a buffer instead of parsing it as JSON. */
  accept?: "json" | "bytes";
};

/** What came back. `text` is kept verbatim so `--json` can print the API's own bytes. */
export type ApiResponse = {
  status: number;
  contentType: string | null;
  /** Present unless `accept: "bytes"`. The raw response body, unparsed. */
  text?: string;
  /** `text` parsed, when it parsed. `undefined` for an empty or non-JSON body. */
  json?: unknown;
  /** Present only for `accept: "bytes"`. */
  bytes?: Uint8Array;
};

/**
 * Build the full URL. Exported for the tests, which assert on the string
 * rather than on a `fetch` mock's internals: a query parameter that silently
 * stops being repeatable (`?platform=nes&platform=snes` collapsing to one) is
 * the kind of bug a mock call count would not notice.
 */
export function buildUrl(target: Target, path: string, query: [string, string][] = []): string {
  const search = new URLSearchParams();
  for (const [k, v] of query) search.append(k, v);
  const qs = search.toString();
  return `${target.baseUrl}${path}${qs ? `?${qs}` : ""}`;
}

/**
 * Open the file the owner named for a raw-bytes upload.
 *
 * This is the only filesystem read in the whole CLI, and it is worth being
 * precise about why it is allowed: the ban this project cares about is on
 * *opening a database* — a `prisma/dev.db` in a checkout that looks like the
 * collection and is not. A map scan, a manual page or an MP3 the owner pointed
 * at is data being handed to the API, not a second source of truth. There is
 * no globbing, no directory walk and no default path: exactly the one file
 * named on the command line.
 *
 * `content-length` is set explicitly from `stat`, because the route on the
 * other end refuses a body that arrives shorter than its declared length
 * (`readUploadBody` in `src/lib/enrichment/http.ts`) — that check is what
 * turns a truncated upload into a `400` instead of a half-written file
 * reported as a success, and it can only fire if we declare a length at all.
 */
async function uploadBody(filePath: string): Promise<{ stream: ReadableStream<Uint8Array>; size: number }> {
  let size: number;
  try {
    const info = await stat(filePath);
    if (!info.isFile()) throw new UsageError(`${filePath} is not a file`);
    size = info.size;
  } catch (e) {
    if (e instanceof UsageError) throw e;
    throw new UsageError(`cannot read ${filePath}: ${e instanceof Error ? e.message : String(e)}`);
  }
  if (size === 0) throw new UsageError(`${filePath} is empty — there is nothing to upload`);
  return { stream: Readable.toWeb(createReadStream(filePath)) as ReadableStream<Uint8Array>, size };
}

/**
 * Pull the message out of a failure body.
 *
 * The happy path is `{ error: "…" }`, which every route in this app produces.
 * The unhappy ones matter more: a 502 from a reverse proxy is HTML, a 401 from
 * `proxy.ts` is JSON, and a Next crash can be a stack trace. Whatever it is,
 * the caller gets the server's own words rather than "request failed" — capped
 * so a 200 KB error page does not become the terminal's problem.
 */
function apiMessage(status: number, text: string, contentType: string | null): { message: string; details: unknown } {
  const trimmed = text.trim();
  if (!trimmed) return { message: `${status} (no response body)`, details: null };

  try {
    const parsed = JSON.parse(trimmed) as { error?: unknown; details?: unknown };
    if (parsed && typeof parsed === "object" && typeof parsed.error === "string") {
      return { message: `${status} ${parsed.error}`, details: parsed.details ?? null };
    }
  } catch {
    // Not JSON. Fall through.
  }

  // An HTML body from this API means Next answered instead of a route handler,
  // which in practice means one thing: **that route is not on that server**.
  // Printing two kilobytes of Next's 404 page would bury the only useful
  // sentence, which is the one about versions — the mini and a checkout are
  // routinely on different commits, and a command that exists here and not
  // there is the expected way this fails.
  if (contentType?.includes("html")) {
    const hint = status === 404 ? " — that route is not on this server. It answered with an HTML page rather than the API's JSON, which usually means the server is running an older build than this checkout." : " — the server answered with an HTML page rather than the API's JSON.";
    return { message: `${status}${hint}`, details: null };
  }
  return { message: `${status} ${trimmed.slice(0, 500)}`, details: null };
}

/**
 * Make the call. Throws `ApiError` on any non-2xx and `UsageError` on a local
 * problem (an unreadable upload, an unreachable host).
 */
export async function request(target: Target, req: ApiRequest, io: Io): Promise<ApiResponse> {
  const url = buildUrl(target, req.path, req.query);
  const headers: Record<string, string> = { authorization: `Bearer ${target.token}` };

  const init: RequestInit & { duplex?: "half" } = { method: req.method, headers };
  if (req.upload) {
    const { stream, size } = await uploadBody(req.upload.filePath);
    headers["content-type"] = req.upload.contentType;
    headers["content-length"] = String(size);
    init.body = stream;
    // Node's fetch refuses a stream body without this; it says "I will finish
    // sending before I start reading", which is true of every upload here.
    init.duplex = "half";
  } else if (req.body !== undefined) {
    headers["content-type"] = "application/json";
    init.body = JSON.stringify(req.body);
  }

  // Before the write, not after: if the process dies mid-request, the last
  // thing on the terminal is still which host was about to be changed.
  if (req.method !== "GET") io.err(`→ ${req.method} ${url}\n`);

  let res: Response;
  try {
    res = await io.fetch(url, init);
  } catch (e) {
    // DNS, connection refused, TLS. Not an API error — nothing answered — so
    // it is reported as a usage problem the caller can act on (wrong host,
    // server not running, not on the wifi).
    throw new UsageError(`could not reach ${url}: ${e instanceof Error ? e.message : String(e)}`);
  }

  const contentType = res.headers.get("content-type");
  if (!res.ok) {
    const { message, details } = apiMessage(res.status, await res.text(), contentType);
    throw new ApiError(res.status, message, details);
  }

  if (req.accept === "bytes") {
    return { status: res.status, contentType, bytes: new Uint8Array(await res.arrayBuffer()) };
  }

  const text = await res.text();
  let json: unknown;
  try {
    json = text.trim() ? JSON.parse(text) : undefined;
  } catch {
    json = undefined;
  }
  return { status: res.status, contentType, text, json };
}
