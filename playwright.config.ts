import { existsSync } from "node:fs";
import { join } from "node:path";
import { defineConfig, devices } from "@playwright/test";

const baseURL = "http://localhost:3000";
const gameServerURL = "http://localhost:3001";
const browserExecutable = [
  process.env.PLAYWRIGHT_CHROME_EXECUTABLE,
  process.env.PROGRAMFILES && join(process.env.PROGRAMFILES, "Google", "Chrome", "Application", "chrome.exe"),
  process.env["PROGRAMFILES(X86)"] && join(process.env["PROGRAMFILES(X86)"], "Microsoft", "Edge", "Application", "msedge.exe"),
].find((candidate): candidate is string => Boolean(candidate && existsSync(candidate)));

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 180_000,
  expect: { timeout: 10_000 },
  reporter: [["list"]],
  use: {
    baseURL,
    headless: true,
    launchOptions: browserExecutable ? { executablePath: browserExecutable } : undefined,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium-desktop",
      use: { viewport: { width: 1440, height: 900 } },
    },
    {
      name: "chromium-mobile",
      use: { ...devices["Pixel 7"] },
    },
  ],
  webServer: [
    {
      command: `"${process.execPath}" node_modules/tsx/dist/cli.mjs server/index.ts`,
      url: `${gameServerURL}/health`,
      timeout: 120_000,
      reuseExistingServer: false,
      env: {
        ...process.env,
        NODE_ENV: "test",
        PORT: "3001",
        PUBLIC_ORIGIN: baseURL,
        YUT_RANDOM_SEED: "task-11-e2e",
      },
    },
    {
      command: `"${process.execPath}" node_modules/vinext/dist/cli.js dev --port 3000`,
      url: baseURL,
      timeout: 120_000,
      reuseExistingServer: false,
      env: {
        ...process.env,
        NEXT_PUBLIC_GAME_SERVER_URL: gameServerURL,
        WRANGLER_WRITE_LOGS: "false",
        WRANGLER_LOG_PATH: ".wrangler/playwright.log",
        MINIFLARE_REGISTRY_PATH: ".wrangler/playwright-registry",
      },
    },
  ],
});
