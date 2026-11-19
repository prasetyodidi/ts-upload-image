import { config as loadEnv } from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "@playwright/test";

loadEnv({
  path: resolve(dirname(fileURLToPath(import.meta.url)), "../.env"),
});

export default defineConfig({
  testDir: ".",
  testMatch: "browser.e2e.ts",
  timeout: 180_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  reporter: "line",
  use: {
    baseURL: process.env.WEB_BASE_URL ?? "http://localhost:8080",
    channel: "chrome",
    headless: true,
    trace: "retain-on-failure",
  },
});
