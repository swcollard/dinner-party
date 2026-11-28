import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { include: ["test/**/*.test.ts"] },
  plugins: [
    cloudflareTest(async () => ({
      wrangler: { configPath: "./wrangler.jsonc" },
      miniflare: {
        bindings: {
          SETUP_SECRET: "unit-test-setup-secret-for-vitest",
          LINK_SECRET: "unit-test-link-secret-for-vitest",
          PUBLIC_BASE_URL: "https://dinner.test",
          TEST_MIGRATIONS: await readD1Migrations("./migrations"),
        },
      },
    })),
  ],
});
