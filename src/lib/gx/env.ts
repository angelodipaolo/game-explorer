/**
 * Which collection this invocation is allowed to touch (GAMEEXPLOR-0036).
 *
 * This file exists because of one specific failure: an agent, following prose
 * that said "use `$GAME_EXPLORER_URL`", ran a shell line carrying a
 * `:-http://localhost:3000` fallback, wrote a game to the throwaway dev
 * database, and reported success. Nothing was wrong with the request, the
 * response, or the report — the collection just never changed, and nobody
 * found out until the owner went looking for the game on their shelf.
 *
 * A rule written in a Markdown file cannot prevent that. A rule written here
 * can, because there is exactly one way for a `gx` command to learn where to
 * send bytes and it goes through `resolveTarget`. So:
 *
 * - **There is no fallback value anywhere in this file, and there must never
 *   be one.** Not a default, not a `??`, not a "if unset, try the usual dev
 *   port". An unset variable is a *stop*, not a hint. If you are tempted to
 *   add one to make a test easier, set the variable in the test instead —
 *   every test in `env.test.ts` does.
 * - **A loopback target is refused unless `--dev` is on that exact
 *   invocation.** Not an env var, not a config file, not a saved preference:
 *   a flag the caller typed, this time, in the command that is about to write.
 *   A guard you can turn on once and forget is a guard that is off.
 *
 * Nothing here reads a file, opens a database, or knows what a command is. It
 * turns an environment plus one boolean into a `Target` or into a
 * `UsageError`, which `run.ts` reports and exits `2` on.
 */

/**
 * A usage problem: something the caller can fix by typing a different command
 * or exporting a variable. Distinct from an API error (exit 1) because the
 * two mean different things to whoever is reading the exit code — a `2` never
 * reached the network, so nothing was written and a retry of the same command
 * will fail the same way.
 */
export class UsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UsageError";
  }
}

/** Where a command is pointed, once both variables have been checked. */
export type Target = {
  /** Origin plus any base path, with no trailing slash: `http://host:3000`. */
  readonly baseUrl: string;
  /** The bearer token every `/api/*` call carries. Never logged, never printed. */
  readonly token: string;
  /** Whether this target is a loopback address the caller unlocked with `--dev`. */
  readonly isDev: boolean;
};

/** The two variables, named once so the error messages and the docs cannot disagree. */
export const URL_VAR = "GAME_EXPLORER_URL";
export const TOKEN_VAR = "GAME_EXPLORER_TOKEN";

/**
 * Is this host the machine the CLI is running on?
 *
 * Broader than the three spellings the ticket names, on purpose. `localhost`,
 * `127.0.0.1` and `::1` are the ones people type, but `127.0.0.2`,
 * `0.0.0.0` and `api.localhost` all reach the same dev server and would all
 * sail past a three-string check. The point of the guard is "you are about to
 * write to the machine you are sitting at", and every one of these is that.
 *
 * `URL.hostname` hands back an IPv6 literal still wrapped in brackets
 * (`[::1]`), and it lowercases and canonicalises the rest — `::1` written any
 * of its legal ways arrives here as `[::1]`. Both spellings are listed anyway,
 * because this function is also called on raw strings in tests.
 */
function isLoopbackHost(hostname: string): boolean {
  // Strip the brackets an IPv6 literal arrives in, and the trailing dot of a
  // fully-qualified name. `localhost.` is a legal spelling of `localhost` —
  // the DNS root written explicitly — and it resolves to 127.0.0.1 like any
  // other. Review drove a real POST through it, so the dot is not pedantry.
  const h = hostname
    .toLowerCase()
    .replace(/^\[|\]$/g, "")
    .replace(/\.$/, "");
  if (h === "localhost" || h.endsWith(".localhost")) return true;
  if (h === "::1" || h === "0:0:0:0:0:0:0:1") return true;
  if (h === "0.0.0.0" || h === "::") return true;
  // The whole 127.0.0.0/8 block is loopback, not just .1.
  if (/^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(h)) return true;
  // An IPv4-mapped IPv6 address is the same machine wearing a different hat,
  // and `URL` canonicalises the readable spelling into hex before we ever see
  // it: `http://[::ffff:127.0.0.1]` arrives as `::ffff:7f00:1`. So match the
  // hex form and re-expand its low 32 bits rather than comparing the dotted
  // string, which never appears. Review reached a loopback server through
  // this one without `--dev`.
  const mapped = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(h);
  if (mapped) {
    const high = Number.parseInt(mapped[1], 16);
    return high >>> 8 === 127;
  }
  // ...and the same address written with a dotted tail, which `URL` leaves
  // alone for a hostname that was never parsed as an address.
  return /^::ffff:127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(h);
}

/**
 * Resolve the target for one invocation, or refuse.
 *
 * `env` is passed in rather than read from `process.env` so the tests can
 * describe an environment instead of mutating the real one — and so nothing
 * in this module has an ambient dependency it could silently pick a default
 * from.
 */
export function resolveTarget(env: Record<string, string | undefined>, options: { dev: boolean }): Target {
  const rawUrl = env[URL_VAR]?.trim();
  if (!rawUrl) {
    throw new UsageError(
      `${URL_VAR} is not set — it names which collection you are writing to, and there is no default.\n` +
        `The real collection lives on the Mac mini; http://localhost:3000 is a disposable dev copy.\n` +
        `Export it (it belongs in ~/.zshenv), or ask the owner which server to use.`,
    );
  }

  const token = env[TOKEN_VAR]?.trim();
  if (!token) {
    throw new UsageError(`${TOKEN_VAR} is not set — every /api/* call needs one of the server's API tokens, and a call without one is a 401.\nExport it (it belongs in ~/.zshenv), or ask the owner for a token.`);
  }

  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new UsageError(`${URL_VAR} is not a URL: ${JSON.stringify(rawUrl)}. It should look like http://cids-Mac-mini.local:3000`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new UsageError(`${URL_VAR} must be an http:// or https:// address, not ${url.protocol}//`);
  }

  const loopback = isLoopbackHost(url.hostname);
  if (loopback && !options.dev) {
    throw new UsageError(
      `refusing to talk to ${url.host}: that is this machine, not the collection.\n` +
        `A write there looks exactly like a write to the shelf and changes nothing the owner will ever see.\n` +
        `If you really do mean the local dev server, pass --dev on this command. If you meant the collection, fix ${URL_VAR}.`,
    );
  }

  // Trailing slashes are stripped once, here, so every call site can write
  // `${baseUrl}${route}` without producing a `//api/...` that some proxies
  // normalise and others 404.
  const baseUrl = (url.origin + url.pathname).replace(/\/+$/, "");
  return { baseUrl, token, isDev: loopback };
}
