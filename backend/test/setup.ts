import { beforeEach, vi } from "vitest";
import { clearSearchCache } from "../src/searchCache.ts";

// Searches are remembered for ten minutes; every test starts with an empty memory.
beforeEach(() => clearSearchCache());

// Adding a game looks up its time to beat on IGDB. Tests never reach IGDB, so by default that lookup comes back as
// "IGDB unreachable" (the game is saved without a snapshot); timeToBeat.test.ts brings back the real one.
vi.mock("../src/timeToBeat.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/timeToBeat.ts")>()),
  fetchTimeToBeat: vi.fn(async () => null),
}));
