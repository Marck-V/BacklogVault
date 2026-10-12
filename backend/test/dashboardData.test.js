import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import request from "supertest";

vi.mock("../src/igdbClient.js", () => ({ igdbRequest: vi.fn() }));

import app from "../src/app.js";
import db from "../src/db.js";
import { igdbRequest } from "../src/igdbClient.js";
import { clearDashboardCaches } from "../src/dashboardData.js";
import { resetDb, newClient, createList, addGame } from "./helpers.js";

const KEY = "TESTKEY0123456789abcdef0123456789";
const STEAM_ID = "76561197960287930";

let client;
let steamCalls;

const jsonResponse = (body) =>
  new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });

function stubSteamRecent(games) {
  steamCalls = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url) => {
      steamCalls.push(new URL(String(url)));
      return jsonResponse({ response: games === null ? {} : { total_count: games.length, games } });
    })
  );
}

// IGDB's Steam catalogue for the external_games query, and genres for the games query.
function stubIgdb({ catalogue = {}, genres = {} } = {}) {
  vi.mocked(igdbRequest).mockImplementation(async (endpoint, query) => {
    if (endpoint === "external_games") {
      return [...query.matchAll(/"(\d+)"/g)]
        .map((m) => m[1])
        .filter((uid) => catalogue[uid])
        .map((uid) => ({ uid, game: catalogue[uid] }));
    }
    if (endpoint === "games") {
      const ids = query.match(/\(([\d,]+)\)/)[1].split(",").map(Number);
      return ids.filter((id) => id in genres).map((id) => ({ id, genres: genres[id].map((name) => ({ name })) }));
    }
    return [];
  });
}

async function userWithSteam() {
  const list = await createList(client);
  await addGame(client, list.id, { igdb_id: 1, name: "Manual Pick" });
  db.prepare("UPDATE users SET steam_id = ?").run(STEAM_ID);
  return list;
}

beforeEach(() => {
  resetDb();
  clearDashboardCaches();
  client = newClient(app);
  vi.mocked(igdbRequest).mockReset();
  vi.stubEnv("STEAM_API_KEY", KEY);
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("GET /api/stats/currently-playing from Steam", () => {
  it("shows what was played in the last two weeks, most played first, with hours", async () => {
    await userWithSteam();
    stubSteamRecent([
      { appid: 570, name: "Dota 2", playtime_2weeks: 90, playtime_forever: 9000 },
      { appid: 220, name: "Half-Life 2", playtime_2weeks: 600, playtime_forever: 700 },
    ]);
    stubIgdb({
      catalogue: {
        570: { id: 2963, name: "Dota 2", cover: { url: "//images.igdb.com/igdb/image/upload/t_thumb/a.jpg" } },
        220: { id: 233, name: "Half-Life 2" },
      },
    });

    const res = await client.get("/api/stats/currently-playing");
    expect(res.body).toMatchObject({ source: "steam", steam_linked: true, steam_failed: false });
    expect(res.body.games).toEqual([
      { igdb_id: 233, name: "Half-Life 2", cover_url: null, hours_last_two_weeks: 10 },
      {
        igdb_id: 2963,
        name: "Dota 2",
        cover_url: "https://images.igdb.com/igdb/image/upload/t_cover_big/a.jpg",
        hours_last_two_weeks: 1.5,
      },
    ]);
    expect(steamCalls[0].pathname).toBe("/IPlayerService/GetRecentlyPlayedGames/v1/");
    expect(steamCalls[0].searchParams.get("steamid")).toBe(STEAM_ID);
  });

  it("asks Steam once per ten minutes, not on every dashboard load", async () => {
    await userWithSteam();
    stubSteamRecent([{ appid: 570, name: "Dota 2", playtime_2weeks: 90 }]);
    stubIgdb({ catalogue: { 570: { id: 2963, name: "Dota 2" } } });

    await client.get("/api/stats/currently-playing");
    await client.get("/api/stats/currently-playing");
    expect(steamCalls).toHaveLength(1);
  });

  it("counts two Steam apps that map to one IGDB game once", async () => {
    await userWithSteam();
    stubSteamRecent([
      { appid: 220, name: "Half-Life 2", playtime_2weeks: 60 },
      { appid: 321, name: "Half-Life 2 Edition", playtime_2weeks: 30 },
    ]);
    stubIgdb({ catalogue: { 220: { id: 233, name: "Half-Life 2" }, 321: { id: 233, name: "Half-Life 2" } } });

    const res = await client.get("/api/stats/currently-playing");
    expect(res.body.games.map((g) => g.igdb_id)).toEqual([233]);
  });

  it("falls back to the games marked Playing when Steam shows nothing recent", async () => {
    const list = await userWithSteam();
    const game = await addGame(client, list.id, { igdb_id: 5, name: "By Hand" });
    await client.put(`/api/lists/${list.id}/games/${game.id}`).send({ status: "Playing" });
    stubSteamRecent(null);

    const res = await client.get("/api/stats/currently-playing");
    expect(res.body.source).toBe("manual");
    expect(res.body.games.map((g) => g.igdb_id)).toEqual([5]);
  });

  it("falls back when Steam is down, and never logs the key", async () => {
    await userWithSteam();
    vi.stubGlobal("fetch", vi.fn(async () => new Response("nope", { status: 503 })));

    const res = await client.get("/api/stats/currently-playing");
    expect(res.status).toBe(200);
    expect(res.body.source).toBe("manual");
    expect(JSON.stringify(console.error.mock.calls)).not.toContain(KEY);
  });

  it("does not call Steam for someone who has never imported", async () => {
    const list = await createList(client);
    await addGame(client, list.id, { igdb_id: 1 });
    stubSteamRecent([{ appid: 570, name: "Dota 2", playtime_2weeks: 90 }]);

    const res = await client.get("/api/stats/currently-playing");
    expect(res.body.source).toBe("manual");
    expect(steamCalls).toHaveLength(0);
  });

  it("does not call Steam when the server has no key", async () => {
    await userWithSteam();
    vi.stubEnv("STEAM_API_KEY", "");
    stubSteamRecent([{ appid: 570, name: "Dota 2", playtime_2weeks: 90 }]);

    expect((await client.get("/api/stats/currently-playing")).body.source).toBe("manual");
    expect(steamCalls).toHaveLength(0);
  });
});

describe("POST /api/steam/refresh", () => {
  it("re-reads Steam even though the last answer is cached", async () => {
    await userWithSteam();
    stubSteamRecent([{ appid: 570, name: "Dota 2", playtime_2weeks: 90 }]);
    stubIgdb({ catalogue: { 570: { id: 2963, name: "Dota 2" }, 220: { id: 233, name: "Half-Life 2" } } });
    await client.get("/api/stats/currently-playing");
    expect(steamCalls).toHaveLength(1);

    stubSteamRecent([
      { appid: 220, name: "Half-Life 2", playtime_2weeks: 300 },
      { appid: 570, name: "Dota 2", playtime_2weeks: 90 },
    ]);
    const res = await client.post("/api/steam/refresh");
    expect(res.status).toBe(200);
    expect(steamCalls).toHaveLength(1); // the new stub's own call
    expect(res.body.currently_playing.games.map((g) => g.name)).toEqual(["Half-Life 2", "Dota 2"]);

    // and the page's next normal load sees the fresh answer without asking Steam again
    const after = await client.get("/api/stats/currently-playing");
    expect(after.body.games.map((g) => g.name)).toEqual(["Half-Life 2", "Dota 2"]);
    expect(steamCalls).toHaveLength(1);
  });

  it("makes you wait between refreshes", async () => {
    await userWithSteam();
    stubSteamRecent([{ appid: 570, name: "Dota 2", playtime_2weeks: 90 }]);
    stubIgdb({ catalogue: { 570: { id: 2963, name: "Dota 2" } } });

    expect((await client.post("/api/steam/refresh")).status).toBe(200);
    const second = await client.post("/api/steam/refresh");
    expect(second.status).toBe(429);
    expect(Number(second.headers["retry-after"])).toBeGreaterThan(0);
    expect(steamCalls).toHaveLength(1);
  });

  it("needs a session and a linked Steam account", async () => {
    expect((await request(app).post("/api/steam/refresh")).status).toBe(401);

    const list = await createList(client);
    await addGame(client, list.id, { igdb_id: 1 });
    const res = await client.post("/api/steam/refresh");
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/Import your Steam library first/);
  });

  it("reports a Steam failure instead of silently showing old data", async () => {
    await userWithSteam();
    vi.stubGlobal("fetch", vi.fn(async () => new Response("no", { status: 503 })));

    const res = await client.post("/api/steam/refresh");
    expect(res.status).toBe(200);
    expect(res.body.currently_playing).toMatchObject({ source: "manual", steam_linked: true, steam_failed: true });
  });
});

describe("GET /api/stats/genres", () => {
  it("returns an empty breakdown for a visitor without a session", async () => {
    const res = await request(app).get("/api/stats/genres");
    expect(res.body).toEqual({ game_count: 0, genres: [], games_without_genre: 0 });
    expect(igdbRequest).not.toHaveBeenCalled();
  });

  it("counts each game once per genre, sorted, and reports games with no genre", async () => {
    const a = await createList(client, "A");
    const b = await createList(client, "B");
    for (const id of [1, 2, 3, 4]) await addGame(client, a.id, { igdb_id: id });
    await addGame(client, b.id, { igdb_id: 1 }); // same game in two lists counts once
    stubIgdb({ genres: { 1: ["RPG", "Adventure"], 2: ["RPG"], 3: ["Shooter"] } }); // 4 has none

    const res = await client.get("/api/stats/genres");
    expect(res.body).toEqual({
      game_count: 4,
      genres: [
        { name: "RPG", count: 2 },
        { name: "Adventure", count: 1 },
        { name: "Shooter", count: 1 },
      ],
      games_without_genre: 1,
    });
  });

  it("keeps the top seven genres and groups the rest as Other", async () => {
    const list = await createList(client);
    const names = ["A", "B", "C", "D", "E", "F", "G", "H", "I"];
    const genres = {};
    for (const [i, name] of names.entries()) {
      await addGame(client, list.id, { igdb_id: i + 1 });
      genres[i + 1] = [name];
    }
    stubIgdb({ genres });

    const res = await client.get("/api/stats/genres");
    expect(res.body.genres).toHaveLength(8);
    expect(res.body.genres.at(-1)).toEqual({ name: "Other", count: 2 });
  });

  it("only asks IGDB about games it has not seen before", async () => {
    const list = await createList(client);
    await addGame(client, list.id, { igdb_id: 1 });
    stubIgdb({ genres: { 1: ["RPG"], 2: ["Shooter"] } });

    await client.get("/api/stats/genres");
    await addGame(client, list.id, { igdb_id: 2 });
    await client.get("/api/stats/genres");

    const queries = vi.mocked(igdbRequest).mock.calls.map(([, q]) => q);
    expect(queries).toHaveLength(2);
    expect(queries[1]).toContain("(2)");
    expect(queries[1]).not.toContain("1,");
  });

  it("splits a big library into batches of 500", async () => {
    const list = await createList(client);
    const insert = db.prepare("INSERT INTO list_games (list_id, igdb_id, name) VALUES (?, ?, ?)");
    db.transaction(() => {
      for (let id = 1; id <= 1001; id++) insert.run(list.id, id, `Game ${id}`);
    })();
    stubIgdb({ genres: {} });

    await client.get("/api/stats/genres");
    expect(vi.mocked(igdbRequest)).toHaveBeenCalledTimes(3);
  });

  it("says IGDB is unavailable instead of drawing a wrong chart", async () => {
    const list = await createList(client);
    await addGame(client, list.id, { igdb_id: 1 });
    vi.mocked(igdbRequest).mockRejectedValue(new Error("boom"));

    const res = await client.get("/api/stats/genres");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ igdb_unavailable: true, game_count: null, genres: [], games_without_genre: 0 });
  });
});
