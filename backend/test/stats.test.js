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
    expect(res.body.source).toBe("manual");
    expect(res.body.games.map((g) => g.igdb_id)).toEqual([1]);
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
      total_hours_played: 0,
      games_left_out: 0,
      games_without_estimate: 0,
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
      total_hours_played: 0,
      total_main_story_seconds: 5400,
      total_completionist_seconds: 12600,
      games_left_out: 0,
      over_limit_games: [],
      games_without_estimate: 0,
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
      total_hours_played: 0,
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

  it("leaves out games whose crowd-sourced time is absurd and says how many", async () => {
    const list = await createList(client);
    for (const id of [1, 2, 3, 4]) await addGame(client, list.id, { igdb_id: id });
    vi.mocked(igdbRequest).mockResolvedValue([
      { game_id: 1, normally: 36000, completely: 72000 },
      { game_id: 2, normally: 216228 * 3600, completely: 300000 * 3600 }, // endless multiplayer game
      { game_id: 3, normally: 10 * 3600, completely: 501 * 3600 }, // 100% time over the limit
      { game_id: 4 }, // IGDB has no data at all
    ]);

    const res = await client.get("/api/stats/time-to-beat");
    expect(res.body.total_main_story_seconds).toBe(36000);
    expect(res.body.total_completionist_seconds).toBe(72000);
    expect(res.body.games_left_out).toBe(2);
    expect(res.body.games_without_estimate).toBe(1);
    expect(res.body.game_count).toBe(4);
  });

  it("keeps a game exactly at the limits", async () => {
    const list = await createList(client);
    await addGame(client, list.id, { igdb_id: 1 });
    vi.mocked(igdbRequest).mockResolvedValue([{ game_id: 1, normally: 200 * 3600, completely: 500 * 3600 }]);

    const res = await client.get("/api/stats/time-to-beat");
    expect(res.body.games_left_out).toBe(0);
    expect(res.body.total_main_story_seconds).toBe(200 * 3600);
  });

  it("totals hours played once per game across lists, for every status, even when IGDB fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const a = await createList(client, "A");
    const b = await createList(client, "B");
    const inA = await addGame(client, a.id, { igdb_id: 1 });
    const inB = await addGame(client, b.id, { igdb_id: 1 });
    const done = await addGame(client, a.id, { igdb_id: 2 });
    await client.put(`/api/lists/${a.id}/games/${inA.id}`).send({ status: "Backlog", hoursPlayed: 10 });
    await client.put(`/api/lists/${b.id}/games/${inB.id}`).send({ status: "Backlog", hoursPlayed: 12.5 });
    await client.put(`/api/lists/${a.id}/games/${done.id}`).send({ status: "Completed", hoursPlayed: 30 });
    vi.mocked(igdbRequest).mockRejectedValue(new Error("boom"));

    const res = await client.get("/api/stats/time-to-beat");
    expect(res.body.total_hours_played).toBe(42.5);
  });

  it("lists the over-limit games and lets the user count one of them", async () => {
    const list = await createList(client);
    await addGame(client, list.id, { igdb_id: 1, name: "Normal" });
    await addGame(client, list.id, { igdb_id: 2, name: "Endless" });
    vi.mocked(igdbRequest).mockResolvedValue([
      { game_id: 1, normally: 3600, completely: 7200 },
      { game_id: 2, normally: 300 * 3600, completely: 400 * 3600 },
    ]);

    let res = await client.get("/api/stats/time-to-beat");
    expect(res.body.games_left_out).toBe(1);
    expect(res.body.over_limit_games).toEqual([
      { igdb_id: 2, name: "Endless", main_story_seconds: 300 * 3600, completionist_seconds: 400 * 3600, included: false },
    ]);

    const put = await client.put("/api/stats/time-to-beat/includes/2").send({ included: true });
    expect(put.status).toBe(200);

    res = await client.get("/api/stats/time-to-beat");
    expect(res.body.games_left_out).toBe(0);
    expect(res.body.total_main_story_seconds).toBe(3600 + 300 * 3600);
    expect(res.body.over_limit_games[0].included).toBe(true);

    await client.put("/api/stats/time-to-beat/includes/2").send({ included: false });
    res = await client.get("/api/stats/time-to-beat");
    expect(res.body.total_main_story_seconds).toBe(3600);
  });

  it("rejects bad input, strangers and games that are not in your lists", async () => {
    const anon = newClient(app);
    expect((await anon.put("/api/stats/time-to-beat/includes/2").send({ included: true })).status).toBe(401);

    const list = await createList(client);
    await addGame(client, list.id, { igdb_id: 2 });
    expect((await client.put("/api/stats/time-to-beat/includes/2").send({ included: "yes" })).status).toBe(400);
    expect((await client.put("/api/stats/time-to-beat/includes/abc").send({ included: true })).status).toBe(400);
    expect((await client.put("/api/stats/time-to-beat/includes/99").send({ included: true })).status).toBe(404);

    const other = newClient(app);
    const theirs = await createList(other, "Theirs");
    await addGame(other, theirs.id, { igdb_id: 7 });
    expect((await client.put("/api/stats/time-to-beat/includes/7").send({ included: true })).status).toBe(404);
  });
});
