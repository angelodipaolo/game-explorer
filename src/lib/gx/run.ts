import { ApiError, request, type ApiRequest, type Io } from "./client";
import { UsageError, resolveTarget } from "./env";
import { commandHelp, groupHelp, topHelp, usageLine } from "./help";
import { render, renderBytes } from "./output";
import { COMMANDS, GROUPS, commandsInGroup, findCommand, isGroup, type Command, type Flag, type ValueType } from "./registry";

/**
 * Parse argv against the registry and make the call (GAMEEXPLOR-0036).
 *
 * `run` **returns** an exit code and never calls `process.exit`. That is not
 * fastidiousness: it is what lets the whole surface — every guardrail, every
 * exit code, the help text, the `→ POST` announcement — be a unit test with a
 * fake `fetch` instead of a shell script nobody runs. `scripts/gx.ts` is the
 * only place that turns the number into an exit.
 *
 * The parser is hand-rolled, per the decision record: no `commander`, no
 * `yargs`, no dependency at all. It is small because the registry does the
 * describing — this file only knows the *grammar* (`<group> <command> [args]
 * [flags]`), never the vocabulary.
 *
 * The three exit codes are the interface an agent actually reads:
 *
 * - **0** — the API answered 2xx.
 * - **1** — the API refused. Its `error` string goes to stderr verbatim,
 *   because those messages were written for whoever caused them and a
 *   paraphrase would lose the part that says what to do next.
 * - **2** — a usage problem: unknown command, missing argument, missing
 *   environment variable, a loopback target without `--dev`. The distinction
 *   from 1 is worth the extra code: a 2 never reached the network, so nothing
 *   was written and nothing needs undoing.
 */

/**
 * Flags handled here rather than by any command. They take no value, may
 * appear anywhere, and are stripped before the command's own parsing runs —
 * so `--dev` is genuinely per-invocation and cannot be smuggled in from an
 * environment variable or a config file. There isn't one, and there must not be.
 */
const GLOBAL_FLAGS = ["--json", "--raw", "--dev", "--help", "-h"] as const;

type Globals = { json: boolean; raw: boolean; dev: boolean; help: boolean };

/** Split the global flags out of argv, keeping everything else in order. */
export function splitGlobals(argv: string[]): { globals: Globals; rest: string[] } {
  const globals: Globals = { json: false, raw: false, dev: false, help: false };
  const rest: string[] = [];
  let literal = false;
  for (const token of argv) {
    // Everything after a bare `--` is a value, even if it looks like a flag.
    if (literal) {
      rest.push(token);
      continue;
    }
    if (token === "--") {
      literal = true;
      rest.push(token);
      continue;
    }
    if (!(GLOBAL_FLAGS as readonly string[]).includes(token)) {
      rest.push(token);
      continue;
    }
    if (token === "--json") globals.json = true;
    else if (token === "--raw") globals.raw = true;
    else if (token === "--dev") globals.dev = true;
    else globals.help = true;
  }
  return { globals, rest };
}

/** What a command's tokens parsed into, before they become a request. */
export type Parsed = {
  positionals: string[];
  /** Flag name (no dashes) → converted value. A repeatable flag holds an array. */
  flags: Map<string, unknown>;
};

/** Turn one typed token into the value the API expects, or explain why it cannot. */
function convert(raw: string, type: ValueType, label: string): unknown {
  if (type === "string") return raw;
  if (type === "int") {
    if (!/^-?\d+$/.test(raw.trim())) throw new UsageError(`${label} wants a whole number, got ${JSON.stringify(raw)}`);
    return Number(raw.trim());
  }
  if (type === "bool") {
    const v = raw.trim().toLowerCase();
    if (["true", "1", "yes"].includes(v)) return true;
    if (["false", "0", "no"].includes(v)) return false;
    throw new UsageError(`${label} wants true or false, got ${JSON.stringify(raw)}`);
  }
  try {
    return JSON.parse(raw);
  } catch (e) {
    throw new UsageError(`${label} wants JSON, and this is not valid JSON: ${e instanceof Error ? e.message : String(e)}`);
  }
}

/**
 * Parse a command's tokens.
 *
 * Long flags only, deliberately: `-v` saves four characters and costs a
 * lifetime of "was that verbose or verified". `--flag value`, `--flag=value`,
 * a bare `--flag` for a boolean and `--no-flag` for its opposite. Everything
 * after `--` is positional, which is how a title that starts with a dash gets
 * through.
 */
export async function parseCommand(cmd: Command, tokens: string[], io: Io): Promise<Parsed> {
  const byName = new Map(cmd.flags.map((f) => [f.name, f]));
  const positionals: string[] = [];
  const flags = new Map<string, unknown>();
  let literal = false;

  const setFlag = (flag: Flag, value: unknown) => {
    if (!flag.repeat) {
      flags.set(flag.name, value);
      return;
    }
    const existing = (flags.get(flag.name) as unknown[] | undefined) ?? [];
    flags.set(flag.name, [...existing, value]);
  };

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (literal || !token.startsWith("-") || token === "-") {
      positionals.push(token);
      continue;
    }
    if (token === "--") {
      literal = true;
      continue;
    }
    if (!token.startsWith("--")) {
      throw new UsageError(`${usageLine(cmd)}\n\nthere are no short flags — did you mean --${token.replace(/^-+/, "")}?`);
    }

    const eq = token.indexOf("=");
    const name = (eq === -1 ? token.slice(2) : token.slice(2, eq)).trim();
    const inline = eq === -1 ? undefined : token.slice(eq + 1);

    // `--no-force` is the readable way to say false; only booleans have one.
    if (!byName.has(name) && name.startsWith("no-") && byName.get(name.slice(3))?.type === "bool") {
      setFlag(byName.get(name.slice(3))!, false);
      continue;
    }

    const flag = byName.get(name);
    if (!flag) {
      const known = cmd.flags.map((f) => `--${f.name}`).join(", ") || "(this command takes no flags)";
      throw new UsageError(`unknown flag --${name} for \`gx ${cmd.group} ${cmd.name}\`.\nIt takes: ${known}\nRun \`npm run gx -- ${cmd.group} ${cmd.name} --help\`.`);
    }

    if (flag.type === "bool" && inline === undefined) {
      setFlag(flag, true);
      continue;
    }

    let raw = inline;
    if (raw === undefined) {
      raw = tokens[++i];
      if (raw === undefined) throw new UsageError(`--${flag.name} needs a value.\n${usageLine(cmd)}`);
    }

    // `--body -` reads the JSON from stdin, so a 500-row batch never has to fit
    // on a command line or through a shell's quoting.
    if (flag.into.kind === "body-json" && raw === "-") raw = await io.readStdin();

    const value = convert(raw, flag.type, `--${flag.name}`);
    if (flag.choices && typeof value === "string" && !flag.choices.includes(value)) {
      throw new UsageError(`--${flag.name} must be one of: ${flag.choices.join(", ")} — got ${JSON.stringify(value)}`);
    }
    setFlag(flag, value);
  }

  return { positionals, flags };
}

/** Assemble the HTTP request from a parsed command line. */
export function buildRequest(cmd: Command, parsed: Parsed): ApiRequest {
  const query: [string, string][] = [];
  let path = cmd.route;
  let body: Record<string, unknown> | undefined;
  let upload: { filePath: string; contentType: string } | undefined;

  // A `--body` supplies the whole JSON object; named body flags then merge on
  // top of it, so `--body @batch.json --replace` is a legal and useful thing to
  // type. It is also what excuses a required flag below: a field the caller put
  // in the body is a field they supplied.
  const bodyFlag = cmd.flags.find((f) => f.into.kind === "body-json");
  const wholeBody = bodyFlag ? parsed.flags.get(bodyFlag.name) : undefined;
  if (wholeBody !== undefined) {
    if (typeof wholeBody !== "object" || wholeBody === null || Array.isArray(wholeBody)) {
      throw new UsageError(`--${bodyFlag!.name} must be a JSON object, e.g. {"codes": [ … ]}`);
    }
    body = { ...(wholeBody as Record<string, unknown>) };
  } else if (cmd.flags.some((f) => f.into.kind === "body")) {
    // Every route that takes body flags parses its body eagerly, so an absent
    // one is a 400 "body is not valid JSON" rather than a no-op. Send `{}`.
    body = {};
  }

  // Positionals, in registry order. Extra ones are an error rather than being
  // ignored: a typo'd id silently dropped is a request against the wrong row.
  if (parsed.positionals.length > cmd.args.length) {
    throw new UsageError(`too many arguments for \`gx ${cmd.group} ${cmd.name}\` — it takes ${cmd.args.length}.\n${usageLine(cmd)}`);
  }
  cmd.args.forEach((arg, i) => {
    const raw = parsed.positionals[i];
    if (raw === undefined) {
      if (arg.required) throw new UsageError(`missing <${arg.name}>: ${arg.summary}\n${usageLine(cmd)}`);
      return;
    }
    if (arg.into.kind === "path") path = path.replace(`[${arg.into.param}]`, encodeURIComponent(raw));
    else if (arg.into.kind === "query") query.push([arg.into.param, raw]);
    else if (arg.into.kind === "file") upload = { filePath: raw, contentType: cmd.contentType ?? "application/octet-stream" };
    else if (arg.into.kind === "body") (body ??= {})[arg.into.field] = convert(raw, arg.type, `<${arg.name}>`);
  });

  for (const flag of cmd.flags) {
    const value = parsed.flags.get(flag.name);
    if (value === undefined) {
      // A required flag is excused by a `--body`, which may carry the field.
      if (flag.required && wholeBody === undefined) throw new UsageError(`--${flag.name} is required: ${flag.summary}\n${usageLine(cmd)}`);
      continue;
    }
    if (flag.into.kind === "query") {
      for (const v of Array.isArray(value) ? value : [value]) query.push([flag.into.param, String(v)]);
    } else if (flag.into.kind === "body") {
      (body ??= {})[flag.into.field] = value;
    }
  }

  // A registry bug, not a user error, but far better caught here than as a 404
  // on a literal `[id]` in the path.
  const leftover = path.match(/\[[^\]]+\]/);
  if (leftover) throw new UsageError(`internal: no argument fills ${leftover[0]} in ${cmd.route} — the registry entry for \`gx ${cmd.group} ${cmd.name}\` is wrong`);

  return { method: cmd.method, path, query, body, upload, accept: cmd.accept ?? "json" };
}

/** "unknown group `code` — did you mean codes?" beats a bare refusal. */
function nearest(input: string, candidates: string[]): string | undefined {
  const lower = input.toLowerCase();
  return candidates.find((c) => c === `${lower}s` || `${c}s` === lower || c.startsWith(lower) || lower.startsWith(c));
}

/**
 * The whole CLI. Returns the process exit code; prints everything through
 * `io`, so a test sees exactly what a terminal would.
 */
export async function run(argv: string[], io: Io): Promise<number> {
  const { globals, rest } = splitGlobals(argv);

  try {
    const [groupName, commandName, ...tokens] = rest;

    if (!groupName || (globals.help && !commandName)) {
      if (groupName && !isGroup(groupName)) throw new UsageError(unknownGroup(groupName));
      if (groupName) {
        io.out(groupHelp(groupName));
        return 0;
      }
      io.out(topHelp());
      return 0;
    }
    if (!isGroup(groupName)) throw new UsageError(unknownGroup(groupName));
    if (!commandName) {
      io.out(groupHelp(groupName));
      return 0;
    }

    const cmd = findCommand(groupName, commandName);
    if (!cmd) {
      const names = commandsInGroup(groupName).map((c) => c.name);
      const guess = nearest(commandName, names);
      throw new UsageError(`\`gx ${groupName}\` has no command "${commandName}".${guess ? ` Did you mean \`${guess}\`?` : ""}\nIt has: ${names.join(", ")}\nRun \`npm run gx -- ${groupName} --help\`.`);
    }
    if (globals.help) {
      io.out(commandHelp(cmd));
      return 0;
    }

    const parsed = await parseCommand(cmd, tokens, io);
    const req = buildRequest(cmd, parsed);

    // Resolved after parsing, so `gx codes add --help` and a typo in a flag
    // both work without the environment being set — but before the call, so a
    // missing variable or a loopback host is refused with nothing sent.
    const target = resolveTarget(io.env, { dev: globals.dev });
    const res = await request(target, req, io);

    if (res.bytes) {
      if (globals.raw) io.outBytes(res.bytes);
      else if (globals.json) io.out(`${JSON.stringify({ status: res.status, contentType: res.contentType, bytes: res.bytes.byteLength })}\n`);
      else io.out(renderBytes(res.contentType, res.bytes));
      return 0;
    }

    // `--json` prints the API's own bytes, not a re-serialisation: an agent
    // piping this into `jq` gets exactly what the server said, key order and
    // all, with nothing else on stdout.
    if (globals.json) io.out(res.text?.trim() ? `${res.text.trim()}\n` : "");
    else io.out(render(res.json));
    return 0;
  } catch (e) {
    if (e instanceof ApiError) {
      io.err(`${e.message}\n`);
      if (e.details !== null && e.details !== undefined) io.err(`${JSON.stringify(e.details, null, 2)}\n`);
      return 1;
    }
    if (e instanceof UsageError) {
      io.err(`${e.message}\n`);
      return 2;
    }
    io.err(`${e instanceof Error ? e.stack || e.message : String(e)}\n`);
    return 1;
  }
}

function unknownGroup(name: string): string {
  const groups = GROUPS.map((g) => g.name);
  const guess = nearest(name, groups);
  return `unknown command group "${name}".${guess ? ` Did you mean \`${guess}\`?` : ""}\nGroups: ${groups.join(", ")}\nRun \`npm run gx -- --help\` for all ${COMMANDS.length} commands.`;
}
