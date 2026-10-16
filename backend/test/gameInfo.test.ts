import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import request from "supertest";

vi.mock("../src/igdbClient.ts", () => ({ igdbRequest: vi.fn() }));

import app from "../src/app.ts";
import db from "../src/db.ts";
import { igdbRequest } from "../src/igdbClient.ts";
import { clearAchievementCache } from "../src/steamAchievements.ts";
import { fetchAchievements } from "../src/steam.ts";
import { ageRatings, audioLanguages, storeLinks, steamAppId } from "../src/gameDetails.ts";
import { resetDb, newClient, createList, type Client } from "./helpers.ts";

// Shaped like the real answer IGDB gave for The Witcher 3 (id 1942), trimmed.
const WITCHER = {
  id: 1942,
  name: "The Witcher 3: Wild Hunt",
  age_ratings: [
    { organization: { name: "ACB" }, rating_category: { rating: "R 18+" } },
    { organization: { name: "PEGI" }, rating_category: { rating: "18" } },
    { organization: { name: "USK" }, rating_category: { rating: "18" } },
    { organization: { name: "ESRB" }, rating_category: { rating: "M" } },
  ],
  language_supports: [
    { language: { name: "Polish" }, language_support_type: { name: "Audio" } },
    { language: { name: "German" }, language_support_type: { name: "Subtitles" } },
    { language: { name: "English" }, language_support_type: { name: "Audio" } },
    { language: { name: "English" }, language_support_type: { name: "Interface" } },
    { language: { name: "French" }, language_support_type: { name: "Audio" } },
    { language: { name: "French" }, language_support_type: { name: "Audio" } },
  ],
  websites: [
    { url: "https://twitter.com/witchergame", type: { type: "Twitter" } },
    { url: "https://www.epicgames.com/store/en-US/product/the-witcher-3-wild-hunt/home", type: { type: "Epic" } },
    { url: "https://store.steampowered.com/app/292030", type: { type: "Steam" } },
    { url: "http://www.thewitcher.com", type: { type: "Official Website" } },
    { url: "https://www.gog.com/game/the_witcher_3_wild_hunt", type: { type: "GOG" } },
  ],
  external_games: [{ uid: "292030", external_game_source: 1 }, { uid: "999", external_game_source: 5 }],
};

describe("reading IGDB's game data", () => {
  it("picks ESRB and PEGI, ESRB first, and ignores the other regions", () => {
    expect(ageRatings(WITCHER)).toEqual([
      { organization: "ESRB", rating: "M" },
      { organization: "PEGI", rating: "18" },
    ]);
  });

  it("falls back to the first rating when a game has neither ESRB nor PEGI", () => {
    const game = { age_ratings: [{ organization: { name: "CERO" }, rating_category: { rating: "Z" } }, { organization: { name: "USK" }, rating_category: { rating: "18" } }] };
    expect(ageRatings(game)).toEqual([{ organization: "CERO", rating: "Z" }]);
  });

  it("returns nothing for missing or malformed ratings", () => {
    expect(ageRatings({})).toEqual([]);
    expect(ageRatings(undefined)).toEqual([]);
    expect(ageRatings({ age_ratings: [{}, { organization: { name: "ESRB" } }, { organization: { name: "PEGI" }, rating_category: { rating: "" } }] })).toEqual([]);
  });

  it("lists only languages with full audio, once each, alphabetically", () => {
    expect(audioLanguages(WITCHER)).toEqual(["English", "French", "Polish"]);
    expect(audioLanguages({})).toEqual([]);
    expect(audioLanguages({ language_supports: [{ language: { name: "German" }, language_support_type: { name: "Subtitles" } }] })).toEqual([]);
  });

  it("finds the four store links in a fixed order and skips every other website", () => {
    expect(storeLinks(WITCHER)).toEqual([
      { key: "steam", label: "Steam", url: "https://store.steampowered.com/app/292030" },
      { key: "gog", label: "GOG", url: "https://www.gog.com/game/the_witcher_3_wild_hunt" },
      { key: "epic", label: "Epic Games Store", url: "https://www.epicgames.com/store/en-US/product/the-witcher-3-wild-hunt/home" },
      { key: "official", label: "Official site", url: "http://www.thewitcher.com/" },
    ]);
  });

  it("only ever passes on web addresses", () => {
    const game = {
      websites: [
        { url: "javascript:alert(1)", type: { type: "Official Website" } },
        { url: "data:text/html,<script>1</script>", type: { type: "GOG" } },
        { url: "not a url", type: { type: "Epic" } },
        { url: "https://" + "a".repeat(600) + ".com", type: { type: "Steam" } },
      ],
    };
    expect(storeLinks(game)).toEqual([]);
  });

  it("builds the Steam link from the app id when IGDB lists no Steam page", () => {
    const game = { websites: [], external_games: [{ uid: "292030", external_game_source: 1 }] };
    expect(storeLinks(game)).toEqual([{ key: "steam", label: "Steam", url: "https://store.steampowered.com/app/292030" }]);
  });

  it("takes the Steam app id only from the Steam source, and only when it is a number", () => {
    expect(steamAppId(WITCHER)).toBe("292030");
    expect(steamAppId({ external_games: [{ uid: "999", external_game_source: 5 }] })).toBeNull();
    expect(steamAppId({ external_games: [{ uid: "12/../x", external_game_source: 1 }] })).toBeNull();
  });
});

describe("GET /api/games/:id/details with the new facts", () => {
  beforeEach(() => vi.mocked(igdbRequest).mockReset());

  it("returns age ratings, audio languages and store links", async () => {
    vi.mocked(igdbRequest).mockResolvedValueOnce([WITCHER]).mockResolvedValueOnce([]);
    const res = await request(app).get("/api/games/1942/details");
    expect(res.status).toBe(200);
    expect(res.body.age_ratings[0]).toEqual({ organization: "ESRB", rating: "M" });
    expect(res.body.audio_languages).toEqual(["English", "French", "Polish"]);
    expect(res.body.store_links.map((l) => l.key)).toEqual(["steam", "gog", "epic", "official"]);
    expect(vi.mocked(igdbRequest).mock.calls[0][1]).toContain("language_supports.language_support_type.name");
  });
});

describe("fetchAchievements (Steam client)", () => {
  afterEach(() => vi.unstubAllGlobals());
  const answer = (status, body) =>
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(body), { status })));

  it("counts unlocked achievements", async () => {
    answer(200, { playerstats: { success: true, achievements: [{ achieved: 1 }, { achieved: 0 }, { achieved: 1 }] } });
    expect(await fetchAchievements("76561197960287930", "292030", "KEY")).toEqual({ status: "ok", total: 3, unlocked: 2 });
  });

  it("says none when the game has no achievements", async () => {
    answer(200, { playerstats: { success: true } });
    expect((await fetchAchievements("1", "2", "KEY")).status).toBe("none");
    answer(400, { playerstats: { success: false, error: "Requested app has no stats" } });
    expect((await fetchAchievements("1", "2", "KEY")).status).toBe("none");
  });

  it("says private when the profile is not public, whether Steam answers 400 or 403", async () => {
    for (const status of [400, 403]) {
      answer(status, { playerstats: { success: false, error: "Profile is not public" } });
      expect((await fetchAchievements("1", "2", "KEY")).status).toBe("private");
    }
  });

  it("treats a Steam outage or a garbled answer as an error, never as a result", async () => {
    answer(500, {});
    await expect(fetchAchievements("1", "2", "KEY")).rejects.toMatchObject({ kind: "unavailable" });
    answer(200, { nothing: true });
    await expect(fetchAchievements("1", "2", "KEY")).rejects.toMatchObject({ kind: "unavailable" });
  });
});

describe("GET /api/games/:id/achievements", () => {
  const KEY = "TESTKEY0123456789abcdef0123456789";
  let client: Client;
  let steamCalls: URL[];

  function stubSteam(playerstats, status = 200) {
    steamCalls = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url) => {
        steamCalls.push(new URL(String(url)));
        return new Response(JSON.stringify({ playerstats }), { status });
      })
    );
  }

  async function connectedUser() {
    await createList(client); // creates the guest account
    db.prepare("UPDATE users SET steam_id = '76561197960287930', steam_verified = 1").run();
  }

  beforeEach(() => {
    resetDb();
    clearAchievementCache();
    client = newClient(app);
    vi.mocked(igdbRequest).mockReset();
    vi.mocked(igdbRequest).mockResolvedValue([{ uid: "292030" }]);
    vi.stubEnv("STEAM_API_KEY", KEY);
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("rejects a bad game id", async () => {
    expect((await client.get("/api/games/abc/achievements")).status).toBe(400);
  });

  it("makes no Steam call for a visitor who has not connected Steam", async () => {
    stubSteam({ success: true, achievements: [{ achieved: 1 }] });
    expect((await client.get("/api/games/1942/achievements")).body).toEqual({ status: "not_connected" });
    await createList(client);
    expect((await client.get("/api/games/1942/achievements")).body).toEqual({ status: "not_connected" });
    expect(steamCalls).toHaveLength(0);
  });

  it("does not count a Steam ID that was typed in rather than verified", async () => {
    await createList(client);
    db.prepare("UPDATE users SET steam_id = '76561197960287930', steam_verified = 0").run();
    stubSteam({ success: true, achievements: [{ achieved: 1 }] });
    expect((await client.get("/api/games/1942/achievements")).body.status).toBe("not_connected");
    expect(steamCalls).toHaveLength(0);
  });

  it("returns the unlocked count for a connected account, and asks Steam about that account's app", async () => {
    await connectedUser();
    stubSteam({ success: true, achievements: [{ achieved: 1 }, { achieved: 0 }, { achieved: 0 }, { achieved: 1 }] });
    const res = await client.get("/api/games/1942/achievements");
    expect(res.body).toEqual({ status: "ok", total: 4, unlocked: 2 });
    expect(steamCalls).toHaveLength(1);
    expect(steamCalls[0].pathname).toBe("/ISteamUserStats/GetPlayerAchievements/v1/");
    expect(steamCalls[0].searchParams.get("steamid")).toBe("76561197960287930");
    expect(steamCalls[0].searchParams.get("appid")).toBe("292030");
    expect(JSON.stringify(res.body)).not.toContain(KEY);
  });

  it("remembers the answer for a while instead of asking Steam on every open", async () => {
    await connectedUser();
    stubSteam({ success: true, achievements: [{ achieved: 1 }] });
    await client.get("/api/games/1942/achievements");
    await client.get("/api/games/1942/achievements");
    expect(steamCalls).toHaveLength(1);
  });

  it("does not remember a private profile, so fixing the setting works on the next open", async () => {
    await connectedUser();
    stubSteam({ success: false, error: "Profile is not public" }, 403);
    expect((await client.get("/api/games/1942/achievements")).body).toEqual({ status: "private" });
    stubSteam({ success: true, achievements: [{ achieved: 1 }] });
    expect((await client.get("/api/games/1942/achievements")).body).toEqual({ status: "ok", total: 1, unlocked: 1 });
  });

  it("says none, without calling Steam, when IGDB has no Steam page for the game", async () => {
    await connectedUser();
    vi.mocked(igdbRequest).mockResolvedValue([]);
    stubSteam({ success: true, achievements: [{ achieved: 1 }] });
    expect((await client.get("/api/games/1942/achievements")).body).toEqual({ status: "none" });
    expect(steamCalls).toHaveLength(0);
  });

  it("says unavailable, and logs no key, when Steam or IGDB fails", async () => {
    await connectedUser();
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 500 })));
    const res = await client.get("/api/games/1942/achievements");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "unavailable" });
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain(KEY);

    vi.mocked(igdbRequest).mockRejectedValue(new Error("igdb down"));
    expect((await client.get("/api/games/1942/achievements")).body).toEqual({ status: "unavailable" });
  });

  it("forgets what it remembered when the person disconnects Steam", async () => {
    await connectedUser();
    stubSteam({ success: true, achievements: [{ achieved: 1 }] });
    await client.get("/api/games/1942/achievements");
    const res = await client.delete("/api/steam/link").send({ deleteLibrary: true });
    expect(res.status).toBe(200);
    expect((await client.get("/api/games/1942/achievements")).body.status).toBe("not_connected");
  });
});
