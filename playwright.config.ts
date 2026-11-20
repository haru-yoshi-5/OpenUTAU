import { defineConfig } from "@playwright/test";

/**
 * 画面の E2E テスト（npm run test:e2e）。
 * ブラウザはインストール済みの Google Chrome を使い、Playwright 用のブラウザをダウンロードしない。
 * 開発サーバー（vp dev）を起動して、そこにアクセスする。起動中のサーバーがあれば使い回す。
 */
const PORT = 5173;

export default defineConfig({
  testDir: "e2e",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"]],
  use: {
    baseURL: `http://localhost:${PORT}`,
    channel: "chrome",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "npm run dev",
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
