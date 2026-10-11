import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    env: { DB_PATH: ":memory:", AUTH_RATE_LIMIT_MAX: "1000" },
    include: ["test/**/*.test.js"],
  },
});
