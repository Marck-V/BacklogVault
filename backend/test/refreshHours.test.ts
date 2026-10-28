import type { ListRow } from "../src/types.ts";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("../src/igdbClient.ts", () => ({ igdbRequest: vi.fn() }));

import app from "../src/app.ts";
import db from "../src/db.ts";
import { igdbRequest } from "../src/igdbClient.ts";
import { clearAchievementCache, gameAchievements } from "../src/steamAchievements.ts";
import { resetDb, newClient, createList, addGame, type Client, dbGet } from "./helpers.ts";

const KEY = "TESTKEY0123456789abcdef0123456789";
const STEAM_ID = "76561197960287930";

let client: Client;
let steamCalls: URL[];
let list: ListRow;

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

// Steam: GetOwnedGames answers with `owned` ([{ appid, playtime_forever }]), recently played with nothing.
function stubSteam(owned: unknown[], { ownedStatus = 200, ownedBody }: { ownedStatus?: number; ownedBody?: unknown } = {}) {
  steamCalls = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url) => {
      const u = new URL(String(url));
      steamCalls.push(u);
      if (u.pathname.includes("GetOwnedGames")) {
        return json(ownedBody ?? { response: { game_count: owned.length, games: owned } }, ownedStatus);
      }
      return json({ response: {} });
    })
  );
}

// IGDB: which Steam app each game is. games = { igdbId: [appid, ...] }
function stubIgdb(games) {
  vi.mocked(igdbRequest).mockImplementation(async (endpoint, query) => {
    if (endpoint !== "external_games") return [];
    const ids = query.match(/game = \(([\d,]+)\)/)?.[1].split(",").map(Number) ?? [];
    return ids.flatMap((id) => (games[id] ?? []).map((uid) => ({ uid: String(uid), game: id })));
  });
}

const hoursOf = (gameId) => dbGet("SELECT hours_played FROM list_games WHERE id = ?", gameId).hours_played;
const refresh = () => client.post("/api/steam/refresh");
const hoursCalls = () => steamCalls.filter((u) => u.pathname.includes("GetOwnedGames"));

beforeEach(async () => {
  resetDb();
  clearAchievementCache();
  client = newClient(app);
  vi.mocked(igdbRequest).mockReset();
  vi.stubEnv("STEAM_API_KEY", KEY);
  vi.spyOn(console, "error").mockImplementation(() => {});
  list = await createList(client);
  db.prepare("UPDATE users SET steam_id = ?, steam_verified = 1").run(STEAM_ID);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("POST /api/steam/refresh: hours", () => {
  it("raises the hours of games already in the library to what Steam says", async () => {
    const a = await addGame(client, list.id, { igdb_id: 10, name: "A" });
    const b = await addGame(client, list.id, { igdb_id: 20, name: "B" });
    db.prepare("UPDATE list_games SET hours_played = 2 WHERE id = ?").run(a.id);
    stubSteam([
      { appid: 111, playtime_forever: 600 }, // 10 hours, A
      { appid: 222, playtime_forever: 90 }, // 1.5 hours, B (had none)
    ]);
    stubIgdb({ 10: [111], 20: [222] });

    const res = await refresh();
    expect(res.status).toBe(200);
    expect(res.body.hours).toEqual({ status: "ok", updated: 2 });
    expect(hoursOf(a.id)).toBe(10);
    expect(hoursOf(b.id)).toBe(1.5);
  });

  it("never lowers hours: a number typed by hand that is higher than Steam's stays", async () => {
    const a = await addGame(client, list.id, { igdb_id: 10, name: "A" });
    db.prepare("UPDATE list_games SET hours_played = 40 WHERE id = ?").run(a.id);
    stubSteam([{ appid: 111, playtime_forever: 35 * 60 }]);
    stubIgdb({ 10: [111] });

    expect((await refresh()).body.hours).toEqual({ status: "ok", updated: 0 });
    expect(hoursOf(a.id)).toBe(40);
  });

  it("changes nothing else about a game, and counts a game in two lists once", async () => {
    const second = await createList(client, "Second");
    const inFirst = await addGame(client, list.id, { igdb_id: 10, name: "A" });
    const inSecond = await addGame(client, second.id, { igdb_id: 10, name: "A" });
    await client.put(`/api/lists/${list.id}/games/${inFirst.id}`).send({ status: "Completed", rating: 9, notes: "Keep" });
    stubSteam([{ appid: 111, playtime_forever: 120 }]);
    stubIgdb({ 10: [111] });

    expect((await refresh()).body.hours.updated).toBe(1);
    expect(hoursOf(inFirst.id)).toBe(2);
    expect(hoursOf(inSecond.id)).toBe(2);
    expect(dbGet("SELECT status, rating, notes FROM list_games WHERE id = ?", inFirst.id)).toEqual({
      status: "Completed",
      rating: 9,
      notes: "Keep",
    });
  });

  it("adds up two Steam apps for one game, like the import does", async () => {
    const a = await addGame(client, list.id, { igdb_id: 10, name: "A" });
    stubSteam([{ appid: 111, playtime_forever: 60 }, { appid: 112, playtime_forever: 120 }]);
    stubIgdb({ 10: [111, 112] });
    await refresh();
    expect(hoursOf(a.id)).toBe(3);
  });

  it("does not add games, and ignores owned games that are not in the library", async () => {
    await addGame(client, list.id, { igdb_id: 10, name: "A" });
    stubSteam([{ appid: 111, playtime_forever: 60 }, { appid: 999, playtime_forever: 6000 }]);
    stubIgdb({ 10: [111], 77: [999] });
    await refresh();
    expect(dbGet("SELECT COUNT(*) AS n FROM list_games").n).toBe(1);
  });

  it("leaves games without Steam playtime alone", async () => {
    const a = await addGame(client, list.id, { igdb_id: 10, name: "A" });
    stubSteam([{ appid: 111, playtime_forever: 0 }]);
    stubIgdb({ 10: [111] });
    expect((await refresh()).body.hours.updated).toBe(0);
    expect(hoursOf(a.id)).toBeNull();
  });

  it("never touches another user's games", async () => {
    const mine = await addGame(client, list.id, { igdb_id: 10, name: "A" });
    const other = newClient(app);
    const theirList = await createList(other, "Theirs");
    const theirs = await addGame(other, theirList.id, { igdb_id: 10, name: "A" });
    stubSteam([{ appid: 111, playtime_forever: 600 }]);
    stubIgdb({ 10: [111] });
    await refresh();
    expect(hoursOf(mine.id)).toBe(10);
    expect(hoursOf(theirs.id)).toBeNull();
  });

  it("makes one Steam call for the hours however big the library is", async () => {
    for (let id = 1; id <= 5; id++) await addGame(client, list.id, { igdb_id: id, name: `G${id}` });
    stubSteam([{ appid: 111, playtime_forever: 60 }]);
    stubIgdb({ 1: [111] });
    await refresh();
    expect(hoursCalls()).toHaveLength(1);
  });

  it("only reads hours every five minutes, but still refreshes recently played", async () => {
    await addGame(client, list.id, { igdb_id: 10, name: "A" });
    stubSteam([{ appid: 111, playtime_forever: 60 }]);
    stubIgdb({ 10: [111] });
    expect((await refresh()).body.hours.status).toBe("ok");

    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(Date.now() + 60 * 1000); // past the 30 second refresh cooldown, inside the hours one
      const again = await refresh();
      expect(again.status).toBe(200);
      expect(again.body.hours).toEqual({ status: "recent" });
      expect(hoursCalls()).toHaveLength(1);

      vi.setSystemTime(Date.now() + 6 * 60 * 1000);
      expect((await refresh()).body.hours.status).toBe("ok");
      expect(hoursCalls()).toHaveLength(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("still answers, with the reason, when the profile is private", async () => {
    const a = await addGame(client, list.id, { igdb_id: 10, name: "A" });
    stubSteam([], { ownedBody: { response: {} } });
    const res = await refresh();
    expect(res.status).toBe(200);
    expect(res.body.currently_playing).toBeTruthy();
    expect(res.body.hours.status).toBe("error");
    expect(res.body.hours.message).toMatch(/Game details to Public/);
    expect(hoursOf(a.id)).toBeNull();
  });

  it("still answers when IGDB or Steam fails, and does not start the hours cooldown", async () => {
    const a = await addGame(client, list.id, { igdb_id: 10, name: "A" });
    stubSteam([{ appid: 111, playtime_forever: 60 }]);
    vi.mocked(igdbRequest).mockRejectedValue(new Error("igdb down"));
    const failed = await refresh();
    expect(failed.status).toBe(200);
    expect(failed.body.hours).toMatchObject({ status: "error" });
    expect(JSON.stringify(failed.body)).not.toContain(KEY);
    expect(hoursOf(a.id)).toBeNull();

    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(Date.now() + 60 * 1000);
      stubIgdb({ 10: [111] });
      expect((await refresh()).body.hours.status).toBe("ok"); // retried at once, no five minute wait
    } finally {
      vi.useRealTimers();
    }
  });

  it("forgets the remembered achievement counts", async () => {
    await addGame(client, list.id, { igdb_id: 10, name: "A" });
    const userId = dbGet<{ id: number }>("SELECT id FROM users").id;
    let unlocked = 1;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url) => {
        const u = new URL(String(url));
        if (u.pathname.includes("GetPlayerAchievements")) {
          return json({ playerstats: { success: true, achievements: Array.from({ length: 5 }, (_, i) => ({ achieved: i < unlocked ? 1 : 0 })) } });
        }
        return json({ response: {} });
      })
    );
    vi.mocked(igdbRequest).mockResolvedValue([{ uid: "111", game: 10 }]);

    expect(await gameAchievements(userId, 10)).toMatchObject({ unlocked: 1 });
    unlocked = 4;
    expect(await gameAchievements(userId, 10)).toMatchObject({ unlocked: 1 }); // remembered

    await refresh();
    expect(await gameAchievements(userId, 10)).toMatchObject({ unlocked: 4 }); // fresh after Refresh
  });
});

describe("refresh also re-reads time to beat", () => {
  const ttbOf = (igdbId) => dbGet("SELECT time_to_beat_main_seconds AS m, time_to_beat_completionist_seconds AS c FROM list_games WHERE igdb_id = ?", igdbId);

  it("saves IGDB's new estimates and says how many games changed", async () => {
    await addGame(client, list.id, { igdb_id: 1, name: "A" });
    await addGame(client, list.id, { igdb_id: 2, name: "B" });
    db.prepare("UPDATE list_games SET time_to_beat_main_seconds = 3600, time_to_beat_completionist_seconds = 7200, time_to_beat_checked_at = 'x' WHERE igdb_id = 1").run();
    stubSteam([]);
    vi.mocked(igdbRequest).mockImplementation(async (endpoint) =>
      endpoint === "game_time_to_beats" ? [{ game_id: 1, normally: 3600, completely: 9000 }, { game_id: 2, normally: 1800 }] : []
    );

    const res = await refresh();
    expect(res.body.time_to_beat).toEqual({ status: "ok", updated: 2 });
    expect(ttbOf(1)).toEqual({ m: 3600, c: 9000 });
    expect(ttbOf(2)).toEqual({ m: 1800, c: null });
  });

  it("keeps a saved estimate when IGDB no longer has one, and when IGDB fails", async () => {
    await addGame(client, list.id, { igdb_id: 1, name: "A" });
    db.prepare("UPDATE list_games SET time_to_beat_main_seconds = 3600, time_to_beat_checked_at = 'x'").run();
    stubSteam([]);
    vi.mocked(igdbRequest).mockResolvedValue([]);
    expect((await refresh()).body.time_to_beat).toEqual({ status: "ok", updated: 0 });
    expect(ttbOf(1).m).toBe(3600);

    vi.mocked(igdbRequest).mockRejectedValue(new Error("down"));
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(Date.now() + 60 * 1000); // past the refresh cooldown
      const res = await refresh();
      expect(res.status).toBe(200);
      expect(res.body.time_to_beat).toEqual({ status: "error" });
      expect(ttbOf(1).m).toBe(3600);
    } finally {
      vi.useRealTimers();
    }
  });
});
