import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    env: {
      DB_PATH: ":memory:",
      AUTH_RATE_LIMIT_MAX: "1000",
      IGDB_ROUTE_RATE_LIMIT: "1000",
      IGDB_MIN_INTERVAL_MS: "0",
      WRITE_RATE_LIMIT: "100000",
      GUEST_RATE_LIMIT: "100000",
    },
    include: ["test/**/*.test.js"],
  },
});
