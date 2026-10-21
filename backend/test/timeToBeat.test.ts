import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("../src/igdbClient.ts", () => ({ igdbRequest: vi.fn() }));
vi.mock("../src/timeToBeat.ts", async (importOriginal) => await importOriginal());

import app from "../src/app.ts";
import { igdbRequest } from "../src/igdbClient.ts";
import { resetDb, newClient, createList, addGame, dbGet, type Client } from "./helpers.ts";

let client: Client;
beforeEach(() => {
  resetDb();
  client = newClient(app);
  vi.mocked(igdbRequest).mockReset();
});

describe("time to beat snapshot", () => {
  it("saves IGDB's estimate when a game is added", async () => {
    vi.mocked(igdbRequest).mockResolvedValue([{ normally: 36000, completely: 90000 }]);
    const list = await createList(client);
    const game = await addGame(client, list.id, { igdb_id: 7 });
    expect(game.time_to_beat_main_seconds).toBe(36000);
    expect(game.time_to_beat_completionist_seconds).toBe(90000);
    expect(igdbRequest).toHaveBeenCalledWith("game_time_to_beats", expect.stringContaining("game_id = 7"));
    expect(dbGet("SELECT time_to_beat_main_seconds AS m FROM list_games WHERE igdb_id = 7").m).toBe(36000);
  });

  it("leaves it empty when IGDB has no estimate", async () => {
    vi.mocked(igdbRequest).mockResolvedValue([]);
    const list = await createList(client);
    const game = await addGame(client, list.id);
    expect(game.time_to_beat_main_seconds).toBeNull();
  });

  it("still adds the game when IGDB fails", async () => {
    vi.mocked(igdbRequest).mockRejectedValue(new Error("down"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const list = await createList(client);
    const res = await client.post(`/api/lists/${list.id}/games`).send({ igdb_id: 1, name: "Hades" });
    expect(res.status).toBe(201);
    expect(res.body.time_to_beat_main_seconds).toBeNull();
  });
});

describe("dashboard reads the snapshot", () => {
  const stats = async () => (await client.get("/api/stats/time-to-beat")).body;

  it("does not call IGDB when every game already has its estimate", async () => {
    vi.mocked(igdbRequest).mockResolvedValue([{ normally: 3600, completely: 7200 }]);
    const list = await createList(client);
    await addGame(client, list.id, { igdb_id: 1 });
    vi.mocked(igdbRequest).mockReset();
    vi.mocked(igdbRequest).mockRejectedValue(new Error("down"));

    expect(await stats()).toMatchObject({ game_count: 1, total_main_story_seconds: 3600, total_completionist_seconds: 7200 });
    expect(igdbRequest).not.toHaveBeenCalled();
  });

  it("fills in games added without an estimate once, then stops asking", async () => {
    vi.mocked(igdbRequest).mockRejectedValue(new Error("down"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const list = await createList(client);
    await addGame(client, list.id, { igdb_id: 5 });
    vi.mocked(igdbRequest).mockReset();
    vi.mocked(igdbRequest).mockResolvedValue([{ game_id: 5, normally: 7200, completely: 9000 }]);

    expect(await stats()).toMatchObject({ total_main_story_seconds: 7200 });
    expect(dbGet("SELECT time_to_beat_main_seconds AS m FROM list_games WHERE igdb_id = 5").m).toBe(7200);
    await stats();
    expect(igdbRequest).toHaveBeenCalledTimes(1);
  });

  it("remembers a game IGDB has no estimate for instead of asking every time", async () => {
    vi.mocked(igdbRequest).mockRejectedValue(new Error("down"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const list = await createList(client);
    await addGame(client, list.id, { igdb_id: 6 });
    vi.mocked(igdbRequest).mockReset();
    vi.mocked(igdbRequest).mockResolvedValue([]);

    expect(await stats()).toMatchObject({ games_without_estimate: 1 });
    await stats();
    expect(igdbRequest).toHaveBeenCalledTimes(1);
  });
});
