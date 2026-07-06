import { existsSync } from "node:fs";
import { defineConfig, devices } from "@playwright/test";

// In the Lovable sandbox, Chromium is pre-installed at a fixed path so we
// can skip Playwright's `npx playwright install`. In CI (or any env where
// that path is absent), fall through to Playwright's own bundled browser.
// Override explicitly with PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH if needed.
const SANDBOX_HEADLESS_SHELL =
  "/chromium_headless_shell-1194/chrome-linux/headless_shell";
const explicit = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
const executablePath =
  explicit && explicit.length > 0
    ? explicit
    : existsSync(SANDBOX_HEADLESS_SHELL)
      ? SANDBOX_HEADLESS_SHELL
      : undefined;

export default defineConfig({
  testDir: "./e2e",
  timeout: 45_000,
  fullyParallel: true,
  retries: process.env.CI ? 2 : 0,
  reporter: [["list"]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:8080",
    trace: "retain-on-failure",
    viewport: { width: 1280, height: 900 },
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        ...(executablePath ? { launchOptions: { executablePath } } : {}),
      },
    },
  ],
});

