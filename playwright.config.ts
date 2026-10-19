import { defineConfig, devices } from "@playwright/test";

// Two phones: Safari's engine with an iPhone profile, Chrome with an Android one.
// Both are emulation on a desktop without a GPU (WebGL runs in software), so these
// tests check behaviour, not real-device speed. The server is the real app (Vite +
// Worker + D1) on its own port with its own database: node scripts/e2e-server.mjs.
const port = process.env.PW_PORT ?? "5542";
const baseURL = process.env.PW_BASE_URL ?? `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: "e2e",
  timeout: 240_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  use: { baseURL, trace: "retain-on-failure" },
  projects: [
    { name: "iphone-webkit", use: { ...devices["iPhone 15"], browserName: "webkit" } },
    { name: "pixel-chrome", use: { ...devices["Pixel 7"], channel: "chrome" } },
  ],
  webServer: process.env.PW_BASE_URL
    ? undefined
    : {
        command: `node scripts/e2e-server.mjs ${port}`,
        url: `${baseURL}/api/health`,
        reuseExistingServer: true,
        timeout: 180_000,
      },
});
