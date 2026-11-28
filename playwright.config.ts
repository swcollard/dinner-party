import { defineConfig, devices } from "@playwright/test";

const url = "http://localhost:8798";
// Separate storage, so tests never touch your local data.
const state = "--persist-to .wrangler/e2e";

export default defineConfig({
  testDir: "e2e",
  workers: 1,
  use: { ...devices["Pixel 7"], baseURL: url },
  webServer: {
    command: [
      // Not rm -rf, so this also runs on Windows.
      `node -e "require('fs').rmSync('.wrangler/e2e', { recursive: true, force: true })"`,
      `npx wrangler d1 migrations apply DB --local ${state}`,
      `npx wrangler dev --port 8798 ${state} --var SETUP_SECRET:end-to-end-browser-testing-setup-secret --var LINK_SECRET:e2e-link-secret-at-least-32-characters --var PUBLIC_BASE_URL:${url}`,
    ].join(" && "),
    url: `${url}/styles.css`,
    timeout: 60_000,
  },
});
