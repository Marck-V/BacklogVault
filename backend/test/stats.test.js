import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("../src/igdbClient.js", () => ({ igdbRequest: vi.fn() }));

import app from "../src/app.js";
import { igdbRequest } from "../src/igdbClient.js";
import { resetDb, newClient, createList, addGame } from "./helpers.js";

let client;

async function setStatus(listId, game, status) {
  await client.put(`/api/lists/${listId}/games/${game.id}`).send({ status });
}

beforeEach(() => {
  resetDb();
  client = newClient(app);
  vi.mocked(igdbRequest).mockReset();
});

describe("GET /api/stats/currently-playing", () => {
  it("returns only Playing games, deduped by igdb_id across lists", async () => {
    const a = await createList(client, "A");
    const b = await createList(client, "B");
    const inA = await addGame(client, a.id, { igdb_id: 1, name: "Hades II" });
    const inB = await addGame(client, b.id, { igdb_id: 1, name: "Hades II" });
    const idle = await addGame(client, a.id, { igdb_id: 2, name: "Idle" });
    await setStatus(a.id, inA, "Playing");
    await setStatus(b.id, inB, "Playing");

    const res = await client.get("/api/stats/currently-playing");
    expect(res.status).toBe(200);
    expect(res.body.map((g) => g.igdb_id)).toEqual([1]);
    expect(idle.status).toBe("Backlog");
  });
});

describe("GET /api/stats/time-to-beat", () => {
  it("returns zeros without calling IGDB when nothing is active", async () => {
    const list = await createList(client);
    const done = await addGame(client, list.id, { igdb_id: 3 });
    await setStatus(list.id, done, "Completed");

    const res = await client.get("/api/stats/time-to-beat");
    expect(res.body).toEqual({
      game_count: 0,
      total_main_story_seconds: 0,
      total_completionist_seconds: 0,
      completed_count: 1,
    });
    expect(igdbRequest).not.toHaveBeenCalled();
  });

  it("only counts Backlog/Playing games, once each, and sums IGDB times", async () => {
    const a = await createList(client, "A");
    const b = await createList(client, "B");
    await addGame(client, a.id, { igdb_id: 1 });
    await addGame(client, b.id, { igdb_id: 1 });
    const playing = await addGame(client, a.id, { igdb_id: 2 });
    const completed = await addGame(client, a.id, { igdb_id: 3 });
    const dropped = await addGame(client, a.id, { igdb_id: 4 });
    await setStatus(a.id, playing, "Playing");
    await setStatus(a.id, completed, "Completed");
    await setStatus(a.id, dropped, "Dropped");

    vi.mocked(igdbRequest).mockResolvedValue([
      { game_id: 1, normally: 3600, completely: 7200 },
      { game_id: 2, normally: 1800, completely: 5400 },
    ]);

    const res = await client.get("/api/stats/time-to-beat");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      game_count: 2,
      completed_count: 1,
      total_main_story_seconds: 5400,
      total_completionist_seconds: 12600,
    });

    const [endpoint, query] = vi.mocked(igdbRequest).mock.calls[0];
    expect(endpoint).toBe("game_time_to_beats");
    const ids = query.match(/\(([\d,]+)\)/)[1].split(",").map(Number).sort();
    expect(ids).toEqual([1, 2]);
  });

  it("treats games with missing IGDB time data as zero", async () => {
    const list = await createList(client);
    await addGame(client, list.id, { igdb_id: 1 });
    vi.mocked(igdbRequest).mockResolvedValue([{ game_id: 1 }]);

    const res = await client.get("/api/stats/time-to-beat");
    expect(res.body.total_main_story_seconds).toBe(0);
    expect(res.body.total_completionist_seconds).toBe(0);
  });

  it("still returns the counts from our own database when IGDB fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const list = await createList(client);
    await addGame(client, list.id, { igdb_id: 1 });
    const done = await addGame(client, list.id, { igdb_id: 2 });
    await setStatus(list.id, done, "Completed");
    vi.mocked(igdbRequest).mockRejectedValue(new Error("boom"));

    const res = await client.get("/api/stats/time-to-beat");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      game_count: 1,
      completed_count: 1,
      total_main_story_seconds: null,
      total_completionist_seconds: null,
      igdb_unavailable: true,
    });
  });

  it("does not flag a normal response as unavailable", async () => {
    const list = await createList(client);
    await addGame(client, list.id, { igdb_id: 1 });
    vi.mocked(igdbRequest).mockResolvedValue([{ game_id: 1, normally: 3600, completely: 7200 }]);

    const res = await client.get("/api/stats/time-to-beat");
    expect(res.body).not.toHaveProperty("igdb_unavailable");
    expect(res.body.total_main_story_seconds).toBe(3600);
  });
});
