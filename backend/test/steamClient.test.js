import { describe, it, expect, afterEach, vi } from "vitest";
import { parseSteamIdentifier, resolveSteamId, fetchOwnedGames, SteamError, MAX_OWNED_APPS } from "../src/steam.js";

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

describe("parseSteamIdentifier", () => {
  it.each([
    [ID, { type: "id", value: ID }],
    [`  ${ID}  `, { type: "id", value: ID }],
    [`https://steamcommunity.com/profiles/${ID}`, { type: "id", value: ID }],
    [`https://steamcommunity.com/profiles/${ID}/`, { type: "id", value: ID }],
    [`steamcommunity.com/profiles/${ID}/games/?tab=all`, { type: "id", value: ID }],
    ["https://steamcommunity.com/id/gaben", { type: "vanity", value: "gaben" }],
    ["https://www.steamcommunity.com/id/gaben/", { type: "vanity", value: "gaben" }],
    ["HTTP://STEAMCOMMUNITY.COM/ID/Gaben", { type: "vanity", value: "Gaben" }],
    ["steamcommunity.com/id/some_name-1?x=1", { type: "vanity", value: "some_name-1" }],
    ["gaben", { type: "vanity", value: "gaben" }],
    ["12345", { type: "vanity", value: "12345" }],
  ])("reads %j", (input, expected) => {
    expect(parseSteamIdentifier(input)).toEqual(expected);
  });

  it.each([
    [""],
    ["   "],
    [null],
    [undefined],
    [42],
    [{}],
    ["a"],
    ["x".repeat(33)],
    ["has space"],
    ["name/with/slash"],
    ["name?query=1"],
    ["https://example.com/id/gaben"],
    ["https://steamcommunity.com/profiles/123"],
    ["https://steamcommunity.com/id/bad name"],
    ["../../etc/passwd"],
    ["<script>alert(1)</script>"],
    ["a".repeat(201)],
  ])("rejects %j", (input) => {
    expect(() => parseSteamIdentifier(input)).toThrow(SteamError);
    try {
      parseSteamIdentifier(input);
    } catch (err) {
      expect(err.kind).toBe("invalid_input");
      expect(err.status).toBe(400);
    }
  });
});

describe("resolveSteamId", () => {
  it("returns a Steam ID unchanged without calling Steam", async () => {
    const fetchMock = stubFetch(() => jsonResponse({}));
    expect(await resolveSteamId({ type: "id", value: ID }, KEY)).toBe(ID);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("looks a custom name up with Steam's vanity endpoint", async () => {
    const fetchMock = stubFetch((url) => {
      expect(url.host).toBe("api.steampowered.com");
      expect(url.pathname).toBe("/ISteamUser/ResolveVanityURL/v1/");
      expect(url.searchParams.get("vanityurl")).toBe("gaben");
      expect(url.searchParams.get("key")).toBe(KEY);
      return jsonResponse({ response: { success: 1, steamid: ID } });
    });
    expect(await resolveSteamId({ type: "vanity", value: "gaben" }, KEY)).toBe(ID);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("reports a name that matches no profile as not found", async () => {
    stubFetch(() => jsonResponse({ response: { success: 42, message: "No match" } }));
    await expect(resolveSteamId({ type: "vanity", value: "nobody-here" }, KEY)).rejects.toMatchObject({
      kind: "not_found",
      status: 404,
    });
  });

  it.each([[{ response: { success: 1, steamid: "not-an-id" } }], [{ response: { success: 9 } }], [{}], [null]])(
    "treats an unexpected answer %j as Steam being unavailable",
    async (body) => {
      stubFetch(() => jsonResponse(body));
      await expect(resolveSteamId({ type: "vanity", value: "gaben" }, KEY)).rejects.toMatchObject({
        kind: "unavailable",
        status: 502,
      });
    }
  );
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
