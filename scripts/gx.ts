#!/usr/bin/env tsx
import { run } from "../src/lib/gx/run";
import type { Io } from "../src/lib/gx/client";

/**
 * `npm run gx -- <group> <command> …` — the bin (GAMEEXPLOR-0036).
 *
 * Everything real lives in `src/lib/gx/`, for one reason: Vitest collects
 * `src/**\/*.test.ts`, so code that lives there can be tested, and a CLI whose
 * guardrails are untested is a CLI whose guardrails are a comment. This file is
 * the four lines that cannot be tested — wiring the process's stdio and
 * environment into `run`, and turning its return value into an exit code.
 *
 * Note what is *not* here: no `dotenv`, no config file, no `.env` read.
 * `GAME_EXPLORER_URL` and `GAME_EXPLORER_TOKEN` come from the environment the
 * command was typed in and nowhere else, so there is exactly one place a wrong
 * target could come from and the caller can see it with `echo`.
 */

const io: Io = {
  fetch: globalThis.fetch,
  env: process.env,
  out: (text) => process.stdout.write(text),
  err: (text) => process.stderr.write(text),
  outBytes: (bytes) => process.stdout.write(bytes),
  readStdin: async () => {
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
    return Buffer.concat(chunks).toString("utf8");
  },
};

// `.then`, not a top-level `await`: this file is CommonJS once tsx has
// transformed it, and a top-level await there is a transform error rather than
// a runtime one — i.e. the CLI would not start at all.
run(process.argv.slice(2), io).then(
  (code) => {
    process.exitCode = code;
  },
  (e: unknown) => {
    // `run` catches everything it knows how to describe; anything reaching here
    // is a bug in the CLI itself, so print the stack rather than a summary.
    console.error(e);
    process.exitCode = 1;
  },
);
