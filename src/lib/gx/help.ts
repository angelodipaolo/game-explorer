import { COMMANDS, GROUPS, commandsInGroup, type Command, type Flag } from "./registry";
import { TOKEN_VAR, URL_VAR } from "./env";

/**
 * `--help`, generated from the registry (GAMEEXPLOR-0036).
 *
 * Not a formatting nicety — the reason the CLI exists. The interface an agent
 * drove before this was a Markdown file describing `curl` invocations, and it
 * drifted from the routes twice because nothing connected the two. Here there
 * is no second copy to drift: the usage line is built from the same `args` the
 * parser consumes, the flags listed are the flags accepted, and the `Calls:`
 * footer prints the same `route` and `method` the request is sent to. If a
 * command's help is wrong, the command is wrong.
 *
 * Which is why **nothing in this file hard-codes a command, a group or a
 * flag**. The only literals here are the global flags, the two environment
 * variables and the exit codes — all of which live in `run.ts` and `env.ts`
 * rather than in the table, so this is where they are described.
 */

/** Where text wraps. Eighty is a terminal; ninety-six is a terminal someone widened. */
const WIDTH = 96;

/** Greedy wrap. Long unbroken tokens (a URL, a JSON example) overhang rather than being cut. */
function wrap(text: string, width: number): string[] {
  const out: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/).filter(Boolean)) {
    if (!line) line = word;
    else if (line.length + 1 + word.length <= width) line += ` ${word}`;
    else {
      out.push(line);
      line = word;
    }
  }
  if (line) out.push(line);
  return out.length ? out : [""];
}

/**
 * A two-column block: a left-hand label, then wrapped prose lined up under
 * itself. The label column is sized to the widest label in *this* block, so a
 * group of short commands does not inherit the indentation of a group with a
 * `marker-update` in it.
 */
function twoColumn(rows: [string, string][], indent = "  ", gap = 2): string[] {
  if (!rows.length) return [];
  const labelWidth = Math.max(...rows.map(([label]) => label.length));
  const textWidth = Math.max(28, WIDTH - indent.length - labelWidth - gap);
  const out: string[] = [];
  for (const [label, text] of rows) {
    const lines = wrap(text, textWidth);
    out.push(`${indent}${label.padEnd(labelWidth)}${" ".repeat(gap)}${lines[0]}`);
    for (const rest of lines.slice(1)) out.push(`${indent}${" ".repeat(labelWidth + gap)}${rest}`);
  }
  return out;
}

/** `--source-url <value>`, `--verified`, `--platform <value> …` — how a flag is typed. */
function flagLabel(flag: Flag): string {
  const value = flag.type === "bool" ? "" : flag.type === "int" ? " <n>" : flag.type === "json" ? " <json>" : " <value>";
  return `--${flag.name}${value}${flag.repeat ? " …" : ""}`;
}

/** The summary a flag shows, with the machine-checkable parts appended rather than written twice. */
function flagText(flag: Flag): string {
  const extra: string[] = [];
  if (flag.required) extra.push("Required.");
  if (flag.choices) extra.push(`One of: ${flag.choices.join(", ")}.`);
  if (flag.repeat) extra.push("Repeatable.");
  return [flag.summary, ...extra].join(" ");
}

/** `gx codes update <ownedGameId> <codeId> [flags]` — the shape of one invocation. */
export function usageLine(cmd: Command): string {
  const args = cmd.args.map((a) => (a.required ? `<${a.name}>` : `[${a.name}]`));
  const hasFlags = cmd.flags.length > 0;
  return ["gx", cmd.group, cmd.name, ...args, hasFlags ? "[flags]" : ""].filter(Boolean).join(" ");
}

/** `gx --help`: what the tool is, how to reach a server, and the groups. */
export function topHelp(): string {
  const lines: string[] = [
    "gx — the Game Explorer agent CLI.",
    "",
    ...wrap("Every command below is one HTTP call to the collection named by $" + URL_VAR + ". Nothing here opens a database, and there is no local fallback: the CLI cannot write to a checkout's disposable dev copy by accident.", WIDTH),
    "",
    "Usage:  npm run gx -- <group> <command> [args] [flags]",
    "",
    "Environment (both required, no defaults):",
    ...twoColumn([
      [URL_VAR, "Which collection you are writing to. The real one lives on the Mac mini; a localhost target is refused unless --dev is on the command."],
      [TOKEN_VAR, "One of the server's API tokens. Every /api/* call carries it; a call without one is a 401, and a 401 is never retried."],
    ]),
    "",
    "Global flags:",
    ...twoColumn([
      ["--json", "Print the API's JSON verbatim to stdout, and nothing else on that stream. Available on every command."],
      ["--raw", "For the three commands that read an image or an audio file: write the bytes to stdout instead of a summary."],
      ["--dev", "Allow a localhost / 127.0.0.1 / ::1 target for this one invocation. Without it, a loopback URL is a refusal."],
      ["--help", "This, or a group's commands, or one command's arguments and flags."],
    ]),
    "",
    "Command groups:",
    ...twoColumn(GROUPS.map((g) => [g.name, g.summary] as [string, string])),
    "",
    ...wrap(`Run \`npm run gx -- <group> --help\` for a group's commands (${COMMANDS.length} in all), and \`npm run gx -- <group> <command> --help\` for one command's arguments.`, WIDTH),
    "",
    "Exit codes:",
    ...twoColumn([
      ["0", "The API answered 2xx."],
      ["1", "The API refused. Its own error message is on stderr, verbatim."],
      ["2", "A usage problem — unknown command, missing argument, missing environment variable, refused localhost. Nothing was sent, so nothing changed."],
    ]),
    "",
  ];
  return lines.join("\n");
}

/** `gx <group> --help`: every command in the group, with the usage line it takes. */
export function groupHelp(group: string): string {
  const meta = GROUPS.find((g) => g.name === group);
  const cmds = commandsInGroup(group);
  const lines: string[] = [
    `gx ${group} — ${meta?.summary ?? ""}`.trimEnd(),
    "",
    "Commands:",
    ...twoColumn(cmds.map((c) => [`${c.name} ${c.args.map((a) => (a.required ? `<${a.name}>` : `[${a.name}]`)).join(" ")}`.trimEnd(), c.summary] as [string, string])),
    "",
    ...wrap(`Run \`npm run gx -- ${group} <command> --help\` for a command's arguments and flags.`, WIDTH),
    "",
  ];
  return lines.join("\n");
}

/** `gx <group> <cmd> --help`: the arguments, the flags, and the route it calls. */
export function commandHelp(cmd: Command): string {
  const lines: string[] = [`Usage:  ${usageLine(cmd)}`, "", ...wrap(cmd.summary, WIDTH)];

  if (cmd.detail) {
    lines.push("", ...wrap(cmd.detail, WIDTH));
  }

  if (cmd.args.length) {
    lines.push("", "Arguments:", ...twoColumn(cmd.args.map((a) => [`<${a.name}>`, a.required ? a.summary : `${a.summary} Optional.`] as [string, string])));
  }

  if (cmd.flags.length) {
    lines.push("", "Flags:", ...twoColumn(cmd.flags.map((f) => [flagLabel(f), flagText(f)] as [string, string])));
  }

  // The footer is the whole point of the registry being data: the path and
  // verb printed here are the ones the request uses, so "which route does this
  // touch" never needs a second source.
  lines.push("", `Calls:  ${cmd.method} ${cmd.route}`);
  if (cmd.method !== "GET") lines.push("", ...wrap(`This command writes. It prints \`→ ${cmd.method} <full url>\` to stderr before it sends, so the host being changed is always visible.`, WIDTH));
  lines.push("");
  return lines.join("\n");
}
