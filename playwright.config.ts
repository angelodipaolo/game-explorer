import { defineConfig, devices } from "@playwright/test";

const port = Number(process.env.E2E_PORT) || 3000;

export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: `http://localhost:${port}`,
    trace: "retain-on-failure",
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "phone", use: { ...devices["iPhone 13"] } },
  ],
  webServer: {
    // `AUTH_OPEN=1` is what puts auth in open mode now that `NODE_ENV` no
    // longer does (src/lib/auth.ts). Without it this server would fail closed
    // and every spec that presses an edit control would go red. `npm run dev`
    // sets the same flag, so a reused server on :3000 is open too.
    // e2e/auth.spec.ts deliberately does *not* set it: it spawns its own
    // `next start` with real credentials.
    env: { AUTH_OPEN: "1" },
    command: `npx next dev`,
    url: `http://localhost:${port}`,
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
