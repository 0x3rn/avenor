import fs from "node:fs";
import path from "node:path";
import { defineConfig, devices } from "@playwright/test";

const PORT = process.env.PORT ? Number(process.env.PORT) : 3000;
const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? `http://localhost:${PORT}`;

function resolveLocalChromiumExecutable(): string | undefined {
  if (process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH) {
    return process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
  }
  const localAppData = process.env.LOCALAPPDATA;
  if (localAppData) {
    const existingPlaywrightChromium = path.join(
      localAppData,
      "ms-playwright",
      "chromium-1234",
      "chrome-win64",
      "chrome.exe",
    );
    if (fs.existsSync(existingPlaywrightChromium)) {
      return existingPlaywrightChromium;
    }
  }
  const systemChrome = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
  if (fs.existsSync(systemChrome)) {
    return systemChrome;
  }
  return undefined;
}

const executablePath = resolveLocalChromiumExecutable();

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: "list",
  expect: {
    timeout: 20000,
  },
  use: {
    baseURL: BASE_URL,
    trace: "off",
    screenshot: "only-on-failure",
    launchOptions: executablePath ? { executablePath } : undefined,
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: "pnpm start",
    url: `${BASE_URL}/api/health`,
    reuseExistingServer: !process.env.CI,
    timeout: 120000,
  },
});
