import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import app from "../src/app.ts";
import { resetDb, newClient, createList, addGame, type Client } from "./helpers.ts";

// Express 5 leaves req.body undefined when a request sends no body (Express 4 gave {}). Every route that changes data
// must answer such a request with a clear 4xx, never a 500 from reading a field of undefined.
let client: Client;
let listId: number;
let gameId: number;

beforeEach(async () => {
  resetDb();
  client = newClient(app);
  listId = (await createList(client)).id;
  gameId = (await addGame(client, listId)).id;
  // With Steam switched off the import answers 503 before reading anything, so switch it on to test the body check.
  vi.stubEnv("STEAM_API_KEY", "TESTKEY0123456789abcdef0123456789");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("write routes with no request body", () => {
  it.each([
    ["POST", "/api/lists"],
    ["POST", "/api/lists/:list/games"],
    ["PUT", "/api/lists/:list/games/:game"],
    ["PUT", "/api/lists/:list/games/:game/hidden"],
    ["PATCH", "/api/lists/:list/games"],
    ["PUT", "/api/stats/time-to-beat/includes/1"],
    ["POST", "/api/library/restore"],
    ["DELETE", "/api/auth/me"],
    ["DELETE", "/api/steam/link"],
    ["POST", "/api/import/steam"],
  ] as const)("%s %s answers 4xx", async (method, path) => {
    const url = path.replace(":list", String(listId)).replace(":game", String(gameId));
    const req =
      method === "POST" ? client.post(url) : method === "PUT" ? client.put(url) : method === "PATCH" ? client.patch(url) : client.delete(url);
    const res = await req;
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
  });
});
