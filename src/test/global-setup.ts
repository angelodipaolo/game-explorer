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
  execSync("npx prisma db push --skip-generate --accept-data-loss", {
    stdio: "pipe",
    env: { ...process.env, DATABASE_URL: "file:./test.db" },
  });
}
