import { defineConfig } from "vitest/config";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "unit",
          environment: "node",
          include: ["tests/unit/**/*.test.ts"],
        },
      },
      {
        plugins: [
          cloudflareTest(async () => ({
            wrangler: { configPath: "./wrangler.jsonc" },
            miniflare: {
              bindings: {
                TEST_MIGRATIONS: await readD1Migrations("migrations"),
                LS_SIGNING_SECRET: "test-signing-secret",
                TOKEN_PEPPER: "test-pepper",
              },
            },
          })),
        ],
        test: {
          name: "worker",
          include: ["tests/worker/**/*.test.ts"],
          setupFiles: ["tests/worker/apply-migrations.ts"],
        },
      },
    ],
  },
});
