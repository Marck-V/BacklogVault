import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import request from "supertest";

vi.mock("../src/igdbClient.ts", () => ({ igdbRequest: vi.fn() }));

import app from "../src/app.ts";
import db from "../src/db.ts";
import { igdbRequest } from "../src/igdbClient.ts";
import { resetDb, newClient, createList, addGame, type Client } from "./helpers.ts";

const KEY = "TESTKEY0123456789abcdef0123456789";
const STEAM_ID = "76561197960287930";
const DAY = 24 * 60 * 60 * 1000;
const ago = (ms: number) => new Date(Date.now() - ms).toISOString();

let client: Client;
let steamCalls: number;

function stubSteamRecent(games: unknown[]) {
  steamCalls = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      steamCalls += 1;
      const body = { response: { total_count: games.length, games } };
      return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
    })
  );
}

function stubSteamDown() {
  steamCalls = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      steamCalls += 1;
      return new Response("no", { status: 503 });
    })
  );
}

function stubIgdb({ catalogue = {}, genres = {} }: { catalogue?: Record<string, unknown>; genres?: Record<number, string[]> } = {}) {
  vi.mocked(igdbRequest).mockReset();
  vi.mocked(igdbRequest).mockImplementation(async (endpoint: string, query: string) => {
    if (endpoint === "external_games") {
      return [...query.matchAll(/"(\d+)"/g)]
        .map((m) => m[1])
        .filter((uid) => (catalogue as Record<string, unknown>)[uid!])
        .map((uid) => ({ uid, game: (catalogue as Record<string, unknown>)[uid!] }));
    }
    const ids = query.match(/\(([\d,]+)\)/)![1]!.split(",").map(Number);
    return ids
      .filter((id) => id in genres)
      .map((id) => ({ id, genres: genres[id]!.map((name) => ({ name })), themes: [], game_modes: [] }));
  });
}

const DOTA = [{ appid: 570, name: "Dota 2", playtime_2weeks: 90, playtime_forever: 9000 }];
const DOTA_CATALOGUE = { 570: { id: 2963, name: "Dota 2" } };

async function userWithSteam() {
  const list = await createList(client);
  await addGame(client, list.id, { igdb_id: 1, name: "Manual Pick" });
  db.prepare("UPDATE users SET steam_id = ?, steam_verified = 1").run(STEAM_ID);
  return list;
}

const count = (table: string) => (db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;

beforeEach(() => {
  resetDb();
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

describe("saved library breakdown going out of date", () => {
  it("asks IGDB again once saved genres are over 30 days old, and keeps the old ones if IGDB is down", async () => {
    const list = await createList(client);
    await addGame(client, list.id, { igdb_id: 1 });
    stubIgdb({ genres: { 1: ["RPG"] } });
    await client.get("/api/stats/breakdown");
    db.prepare("UPDATE game_metadata SET fetched_at = ?").run(ago(31 * DAY));

    vi.mocked(igdbRequest).mockReset();
    vi.mocked(igdbRequest).mockRejectedValue(new Error("IGDB is down"));
    const old = await client.get("/api/stats/breakdown");
    expect(old.body.genres.items).toEqual([{ name: "RPG", count: 1 }]);
    expect(old.body.not_loaded).toBeUndefined();

    stubIgdb({ genres: { 1: ["Strategy"] } });
    const fresh = await client.get("/api/stats/breakdown");
    expect(fresh.body.genres.items).toEqual([{ name: "Strategy", count: 1 }]);
  });

  it("does not ask IGDB at all while saved genres are recent", async () => {
    const list = await createList(client);
    await addGame(client, list.id, { igdb_id: 1 });
    stubIgdb({ genres: { 1: ["RPG"] } });
    await client.get("/api/stats/breakdown");
    vi.mocked(igdbRequest).mockClear();

    await client.get("/api/stats/breakdown");
    expect(vi.mocked(igdbRequest)).not.toHaveBeenCalled();
  });

  it("draws what it has and says how many games were left out when IGDB fails for new ones", async () => {
    const list = await createList(client);
    await addGame(client, list.id, { igdb_id: 1, name: "Known" });
    stubIgdb({ genres: { 1: ["RPG"] } });
    await client.get("/api/stats/breakdown");

    await addGame(client, list.id, { igdb_id: 2, name: "New" });
    vi.mocked(igdbRequest).mockReset();
    vi.mocked(igdbRequest).mockRejectedValue(new Error("IGDB is down"));
    const res = await client.get("/api/stats/breakdown");
    expect(res.body.game_count).toBe(1);
    expect(res.body.not_loaded).toBe(1);
    expect(res.body.genres.without).toBe(0);
  });
});

describe("saved recently played list", () => {
  it("serves a recent saved list without asking Steam again", async () => {
    await userWithSteam();
    stubSteamRecent(DOTA);
    stubIgdb({ catalogue: DOTA_CATALOGUE });
    await client.get("/api/stats/currently-playing");
    stubSteamRecent([]);

    const res = await client.get("/api/stats/currently-playing");
    expect(res.body.games.map((g: { igdb_id: number }) => g.igdb_id)).toEqual([2963]);
    expect(res.body.steam_failed).toBe(false);
    expect(steamCalls).toBe(0);
  });

  it("marks an old saved list with when it was read once Steam fails", async () => {
    await userWithSteam();
    stubSteamRecent(DOTA);
    stubIgdb({ catalogue: DOTA_CATALOGUE });
    await client.get("/api/stats/currently-playing");
    const readAt = ago(2 * 60 * 60 * 1000);
    db.prepare("UPDATE steam_recent_state SET fetched_at = ?").run(readAt);
    stubSteamDown();

    const res = await client.get("/api/stats/currently-playing");
    expect(res.body).toMatchObject({ source: "steam", steam_failed: true, stale_since: readAt });
    expect(res.body.games).toEqual([
      { igdb_id: 2963, name: "Dota 2", cover_url: null, hours_last_two_weeks: 1.5, minutes_last_two_weeks: 90 },
    ]);
  });

  it("does not show the saved list of a different Steam account", async () => {
    await userWithSteam();
    stubSteamRecent(DOTA);
    stubIgdb({ catalogue: DOTA_CATALOGUE });
    await client.get("/api/stats/currently-playing");
    db.prepare("UPDATE users SET steam_id = '76561197960287931'").run();
    stubSteamDown();

    const res = await client.get("/api/stats/currently-playing");
    expect(res.body).toMatchObject({ source: "manual", steam_failed: true });
    expect(res.body.stale_since).toBeUndefined();
  });

  it("treats an empty answer from Steam as a real answer, so the old list is not shown again", async () => {
    await userWithSteam();
    stubSteamRecent(DOTA);
    stubIgdb({ catalogue: DOTA_CATALOGUE });
    await client.get("/api/stats/currently-playing");
    stubSteamRecent([]);
    await client.post("/api/steam/refresh");

    expect(count("steam_recent_games")).toBe(0);
    expect((await client.get("/api/stats/currently-playing")).body.source).toBe("manual");
  });

  it("deletes the saved list and the history when Steam is disconnected", async () => {
    await userWithSteam();
    stubSteamRecent(DOTA);
    stubIgdb({ catalogue: DOTA_CATALOGUE });
    await client.get("/api/stats/currently-playing");
    expect([count("steam_recent_games"), count("steam_recent_state"), count("playtime_snapshots")]).toEqual([1, 1, 1]);

    expect((await client.delete("/api/steam/link").send({ deleteLibrary: true })).status).toBe(200);
    expect([count("steam_recent_games"), count("steam_recent_state"), count("playtime_snapshots")]).toEqual([0, 0, 0]);
  });

  it("is deleted with the account", async () => {
    await userWithSteam();
    stubSteamRecent(DOTA);
    stubIgdb({ catalogue: DOTA_CATALOGUE });
    await client.get("/api/stats/currently-playing");

    await client.delete("/api/auth/me").send({ deleteEverything: true });
    expect([count("steam_recent_games"), count("steam_recent_state")]).toEqual([0, 0]);
  });

  it("leaves a visitor without a session with nothing saved", async () => {
    await request(app).get("/api/stats/currently-playing");
    expect([count("steam_recent_games"), count("playtime_snapshots")]).toEqual([0, 0]);
  });
});
