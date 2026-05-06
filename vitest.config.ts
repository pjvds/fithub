import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["packages/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"],
      exclude: [
        "**/dist/**",
        "**/.sst/**",
        "**/node_modules/**",
        // Barrel re-export files — no executable logic
        "**/src/index.ts",
        "**/src/*/index.ts",
        // Type-only declarations — no runtime functions
        "**/src/adapters/types.ts",
        // Drizzle schema definitions — column/table builders, not application logic
        "**/src/db/schema.ts",
      ],
    },
  },
});
