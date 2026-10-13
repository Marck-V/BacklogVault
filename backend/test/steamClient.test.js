import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import db from "../src/db.js";
import { fetchOwnedGames, fetchRecentlyPlayed, SteamError, MAX_OWNED_APPS } from "../src/steam.js";

const KEY = "TESTKEY0123456789abcdef0123456789";
const ID = "76561197960287930";

const jsonResponse = (body, init = {}) =>
  new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" }, ...init });

function stubFetch(handler) {
  const fetchMock = vi.fn(async (url) => handler(new URL(String(url))));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("fetchOwnedGames", () => {
  it("asks for names and free games, and normalises what comes back", async () => {
    stubFetch((url) => {
      expect(url.pathname).toBe("/IPlayerService/GetOwnedGames/v1/");
      expect(url.searchParams.get("steamid")).toBe(ID);
      expect(url.searchParams.get("include_appinfo")).toBe("1");
      expect(url.searchParams.get("include_played_free_games")).toBe("1");
      return jsonResponse({
        response: {
          game_count: 5,
          games: [
            { appid: 570, name: "Dota 2", playtime_forever: 600 },
            { appid: 220, name: "  Half-Life 2  ", playtime_forever: 0 },
            { appid: 10, playtime_forever: 5 },
            { appid: "bad", name: "Not an id" },
            { name: "No id at all" },
            { appid: -3, name: "Negative" },
          ],
        },
      });
    });

    expect(await fetchOwnedGames(ID, KEY)).toEqual([
      { appid: 570, name: "Dota 2", minutes: 600 },
      { appid: 220, name: "Half-Life 2", minutes: 0 },
      { appid: 10, name: "Steam app 10", minutes: 5 },
    ]);
  });

  it("treats a missing or odd playtime as zero minutes", async () => {
    stubFetch(() =>
      jsonResponse({ response: { games: [{ appid: 1, name: "A" }, { appid: 2, name: "B", playtime_forever: "lots" }, { appid: 3, name: "C", playtime_forever: -5 }] } })
    );
    const games = await fetchOwnedGames(ID, KEY);
    expect(games.map((g) => g.minutes)).toEqual([0, 0, 0]);
  });

  it("explains how to fix a private profile (Steam answers with an empty object)", async () => {
    stubFetch(() => jsonResponse({ response: {} }));
    const err = await fetchOwnedGames(ID, KEY).catch((e) => e);
    expect(err).toMatchObject({ kind: "private", status: 422 });
    expect(err.message).toMatch(/Game details to Public/);
  });

  it("says so when the account genuinely has no games", async () => {
    stubFetch(() => jsonResponse({ response: { game_count: 0 } }));
    await expect(fetchOwnedGames(ID, KEY)).rejects.toMatchObject({ kind: "empty", status: 422 });
  });

  it("refuses an unreasonably large library", async () => {
    const games = Array.from({ length: MAX_OWNED_APPS + 1 }, (_, i) => ({ appid: i + 1, name: `G${i}` }));
    stubFetch(() => jsonResponse({ response: { games } }));
    await expect(fetchOwnedGames(ID, KEY)).rejects.toMatchObject({ kind: "too_large", status: 422 });
  });
});

describe("failures never leak the API key", () => {
  it("hides the key when the network call itself fails", async () => {
    // A real failed fetch can put the full URL, key included, in its message.
    vi.stubGlobal("fetch", vi.fn(async (url) => Promise.reject(new TypeError(`fetch failed: ${url}`))));
    const err = await fetchOwnedGames(ID, KEY).catch((e) => e);
    expect(err).toMatchObject({ kind: "unavailable", status: 502 });
    expect(JSON.stringify(err)).not.toContain(KEY);
    expect(err.message).not.toContain(KEY);
    expect(String(err.stack)).not.toContain(KEY);
  });

  it.each([[403], [401], [429], [500], [503]])("treats Steam's HTTP %i as unavailable and remembers only the status", async (status) => {
    stubFetch(() => new Response("denied", { status }));
    const err = await fetchOwnedGames(ID, KEY).catch((e) => e);
    expect(err).toMatchObject({ kind: "unavailable", status: 502, upstreamStatus: status });
    expect(err.message).not.toContain(KEY);
  });

  it("treats an answer that is not JSON as unavailable", async () => {
    stubFetch(() => new Response("<html>maintenance</html>", { status: 200 }));
    await expect(fetchOwnedGames(ID, KEY)).rejects.toMatchObject({ kind: "unavailable" });
  });

  it("puts a 10 second limit on every call and treats hitting it as unavailable", async () => {
    // Node's AbortSignal.timeout does not use fake timers, so control the signal it would have produced.
    const controller = new AbortController();
    const timeout = vi.spyOn(AbortSignal, "timeout").mockReturnValue(controller.signal);
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (url, options) =>
          new Promise((resolve, reject) => options.signal.addEventListener("abort", () => reject(new Error(`aborted ${url}`))))
      )
    );

    const pending = fetchOwnedGames(ID, KEY).catch((e) => e);
    controller.abort();
    const err = await pending;

    expect(timeout).toHaveBeenCalledWith(10000);
    expect(err).toMatchObject({ kind: "unavailable", status: 502 });
    expect(JSON.stringify(err)).not.toContain(KEY);
    timeout.mockRestore();
  });
});

describe("fetchRecentlyPlayed", () => {
  it("returns the last two weeks of play, most played first", async () => {
    stubFetch((url) => {
      expect(url.pathname).toBe("/IPlayerService/GetRecentlyPlayedGames/v1/");
      expect(url.searchParams.get("steamid")).toBe(ID);
      return jsonResponse({
        response: {
          total_count: 3,
          games: [
            { appid: 220, name: "Half-Life 2", playtime_2weeks: 30, playtime_forever: 500 },
            { appid: 570, name: "Dota 2", playtime_2weeks: 600 },
            { appid: "bad", name: "Broken", playtime_2weeks: 5 },
          ],
        },
      });
    });
    expect(await fetchRecentlyPlayed(ID, KEY)).toEqual([
      { appid: 570, name: "Dota 2", minutes: 600 },
      { appid: 220, name: "Half-Life 2", minutes: 30 },
    ]);
  });

  it("gives an empty list when nothing was played or the profile is private", async () => {
    stubFetch(() => jsonResponse({ response: {} }));
    expect(await fetchRecentlyPlayed(ID, KEY)).toEqual([]);
  });

  it("throws a key-free error when Steam is down", async () => {
    stubFetch(() => new Response("no", { status: 503 }));
    const err = await fetchRecentlyPlayed(ID, KEY).catch((e) => e);
    expect(err).toBeInstanceOf(SteamError);
    expect(JSON.stringify(err)).not.toContain(KEY);
    expect(err.message).not.toContain(KEY);
  });
});

describe("the daily call budget", () => {
  const today = () => new Date().toISOString().slice(0, 10);
  const used = (day = today()) => db.prepare("SELECT calls FROM steam_api_usage WHERE day = ?").get(day)?.calls ?? 0;
  const answer = () => jsonResponse({ response: { games: [{ appid: 570, name: "Dota 2", playtime_forever: 60 }] } });

  beforeEach(() => {
    db.exec("DELETE FROM steam_api_usage");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.useRealTimers();
  });

  it("counts every call to the Steam Web API", async () => {
    stubFetch(answer);
    await fetchOwnedGames(ID, KEY);
    await fetchRecentlyPlayed(ID, KEY);
    expect(used()).toBe(2);
  });

  it("stops before the limit is passed, without calling Steam", async () => {
    vi.stubEnv("STEAM_DAILY_CALL_LIMIT", "3");
    const fetchMock = stubFetch(answer);
    for (let i = 0; i < 3; i++) await fetchOwnedGames(ID, KEY);

    const err = await fetchOwnedGames(ID, KEY).catch((e) => e);
    expect(err).toBeInstanceOf(SteamError);
    expect(err.kind).toBe("quota");
    expect(err.status).toBe(503);
    expect(err.message).toMatch(/try again tomorrow/);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(used()).toBe(3);
  });

  it("starts a fresh count on the next day", async () => {
    vi.stubEnv("STEAM_DAILY_CALL_LIMIT", "1");
    stubFetch(answer);
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-12T23:59:00Z"));
    await fetchOwnedGames(ID, KEY);
    await expect(fetchOwnedGames(ID, KEY)).rejects.toMatchObject({ kind: "quota" });

    vi.setSystemTime(new Date("2026-10-13T00:01:00Z"));
    await expect(fetchOwnedGames(ID, KEY)).resolves.toHaveLength(1);
    expect(used("2026-10-12")).toBe(1);
    expect(used("2026-10-13")).toBe(1);
  });

  it("keeps a safe margin below Steam's 100,000-a-day limit by default", async () => {
    const { DEFAULT_DAILY_CALL_LIMIT } = await import("../src/steam.js");
    expect(DEFAULT_DAILY_CALL_LIMIT).toBeLessThan(100000);
    expect(DEFAULT_DAILY_CALL_LIMIT).toBeGreaterThanOrEqual(80000);
  });

  it("is remembered in the database, so a restart does not reset it", async () => {
    vi.stubEnv("STEAM_DAILY_CALL_LIMIT", "2");
    db.prepare("INSERT INTO steam_api_usage (day, calls) VALUES (?, 2)").run(today());
    stubFetch(answer);
    await expect(fetchOwnedGames(ID, KEY)).rejects.toMatchObject({ kind: "quota" });
  });
});
