import { defineConfig, devices } from "@playwright/test";

// Point Playwright at the sandbox's pre-installed Chromium headless shell
// so tests can run without downloading browsers.
const HEADLESS_SHELL =
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ??
  "/chromium_headless_shell-1194/chrome-linux/headless_shell";

export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  fullyParallel: true,
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
        launchOptions: { executablePath: HEADLESS_SHELL },
      },
    },
  ],
});
