import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

// Every vitest run gets a fresh SQLite file built from the Prisma schema, so
// tests never touch prisma/dev.db.
export default function globalSetup() {
  const dbPath = path.resolve(__dirname, "../../prisma/test.db");
  for (const suffix of ["", "-journal", "-shm", "-wal"]) {
    fs.rmSync(dbPath + suffix, { force: true });
  }
  process.env.DATABASE_URL = "file:./test.db";
  // `migrate deploy` rather than `db push`: some DDL lives only in migration
  // SQL because Prisma's schema language cannot express it — the partial
  // unique index that allows one open PlaySession per copy is the first. A
  // pushed schema would silently lack the constraints production has.
  execSync("npx prisma migrate deploy", {
    stdio: "pipe",
    env: { ...process.env, DATABASE_URL: "file:./test.db" },
  });
}
