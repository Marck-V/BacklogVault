import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import request from "supertest";

vi.mock("../src/igdbClient.js", () => ({ igdbRequest: vi.fn() }));

import app from "../src/app.js";
import db from "../src/db.js";
import { igdbRequest } from "../src/igdbClient.js";
import { LIMITS } from "../src/limits.js";
import { hoursFromMinutes, coverUrlFor } from "../src/steamImport.js";
import { resetDb, newClient, createList } from "./helpers.js";

const KEY = "TESTKEY0123456789abcdef0123456789";
const ID = "76561197960287930";

// IGDB's view of the Steam catalogue: appid -> game.
const CATALOGUE = {
  570: { id: 2963, name: "Dota 2", cover: "//images.igdb.com/igdb/image/upload/t_thumb/cobfk4.jpg" },
  220: { id: 233, name: "Half-Life 2", cover: "//images.igdb.com/igdb/image/upload/t_thumb/co1nmw.jpg" },
  1145360: { id: 113112, name: "Hades", cover: null },
  730: { id: 242408, name: "Counter-Strike 2", cover: "//images.igdb.com/igdb/image/upload/t_thumb/coaczd.jpg" },
  // A second Steam app that IGDB maps to the same game as appid 220 (for example an edition).
  321: { id: 233, name: "Half-Life 2", cover: "//images.igdb.com/igdb/image/upload/t_thumb/co1nmw.jpg" },
};

const jsonResponse = (body, init = {}) =>
  new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" }, ...init });

let steamCalls;
let igdbQueries;
let owned;
let vanity;

function installFakes() {
  steamCalls = [];
  igdbQueries = [];
  vanity = { gaben: ID };

  vi.stubGlobal(
    "fetch",
    vi.fn(async (url) => {
      const u = new URL(String(url));
      steamCalls.push(u);
      if (u.pathname === "/ISteamUser/ResolveVanityURL/v1/") {
        const found = vanity[u.searchParams.get("vanityurl")];
        return jsonResponse({ response: found ? { success: 1, steamid: found } : { success: 42 } });
      }
      if (u.pathname === "/IPlayerService/GetOwnedGames/v1/") return jsonResponse({ response: owned });
      return new Response("unexpected", { status: 500 });
    })
  );

  vi.mocked(igdbRequest).mockReset();
  vi.mocked(igdbRequest).mockImplementation(async (endpoint, query) => {
    igdbQueries.push({ endpoint, query });
    const uids = /uid = \(([^)]*)\)/.exec(query)?.[1].match(/\d+/g) ?? [];
    return uids
      .filter((uid) => CATALOGUE[uid])
      .map((uid) => ({
        uid,
        game: { id: CATALOGUE[uid].id, name: CATALOGUE[uid].name, ...(CATALOGUE[uid].cover ? { cover: { url: CATALOGUE[uid].cover } } : {}) },
      }));
  });
}

let client;
let list;
beforeEach(async () => {
  resetDb();
  process.env.STEAM_API_KEY = KEY;
  owned = {
    game_count: 4,
    games: [
      { appid: 570, name: "Dota 2", playtime_forever: 600 },
      { appid: 220, name: "Half-Life 2", playtime_forever: 0 },
      { appid: 1145360, name: "Hades", playtime_forever: 90 },
      { appid: 999999, name: "Some Soundtrack", playtime_forever: 0 },
    ],
  };
  installFakes();
  vi.spyOn(console, "error").mockImplementation(() => {});
  client = newClient(app);
  list = await createList(client, "Steam");
});

afterEach(() => {
  delete process.env.STEAM_API_KEY;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const importIt = (body, agent = client) => agent.post("/api/import/steam").send(body);
const gamesInList = () => db.prepare("SELECT * FROM list_games WHERE list_id = ? ORDER BY igdb_id").all(list.id);

describe("helpers", () => {
  it.each([[0, null], [-5, null], [1, 0], [3, 0.1], [6, 0.1], [90, 1.5], [600, 10], [610, 10.2]])(
    "converts %i minutes to %j hours",
    (minutes, hours) => {
      expect(hoursFromMinutes(minutes)).toBe(hours);
    }
  );

  it("turns an IGDB thumbnail into a full cover URL, and keeps a missing one empty", () => {
    expect(coverUrlFor("//images.igdb.com/igdb/image/upload/t_thumb/abc.jpg")).toBe(
      "https://images.igdb.com/igdb/image/upload/t_cover_big/abc.jpg"
    );
    expect(coverUrlFor(undefined)).toBeNull();
  });
});

describe("GET /api/import/steam/status", () => {
  it("reports whether the server has a Steam key", async () => {
    expect((await request(app).get("/api/import/steam/status")).body).toEqual({ enabled: true });
    delete process.env.STEAM_API_KEY;
    expect((await request(app).get("/api/import/steam/status")).body).toEqual({ enabled: false });
  });

  it("never reveals the key", async () => {
    const res = await request(app).get("/api/import/steam/status");
    expect(JSON.stringify(res.body)).not.toContain(KEY);
  });
});

describe("a successful import", () => {
  it("adds matched games as Backlog with their Steam hours and a full cover URL", async () => {
    const res = await importIt({ listId: list.id, steam: ID });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ steamId: ID, owned: 4, matched: 3, imported: 3, alreadyInList: 0, skippedOverCap: 0, unmatched: 1 });
    expect(res.body.unmatchedSample).toEqual(["Some Soundtrack"]);

    const games = gamesInList();
    expect(games.map((g) => g.name).sort()).toEqual(["Dota 2", "Hades", "Half-Life 2"]);
    expect(games.every((g) => g.status === "Backlog")).toBe(true);

    const byName = Object.fromEntries(games.map((g) => [g.name, g]));
    expect(byName["Dota 2"].hours_played).toBe(10);
    expect(byName["Hades"].hours_played).toBe(1.5);
    expect(byName["Half-Life 2"].hours_played).toBeNull();
    expect(byName["Dota 2"].cover_url).toBe("https://images.igdb.com/igdb/image/upload/t_cover_big/cobfk4.jpg");
    expect(byName["Hades"].cover_url).toBeNull();
  });

  it("remembers the Steam account on the user, for the recently played widget", async () => {
    expect(db.prepare("SELECT steam_id FROM users").get().steam_id).toBeNull();
    await importIt({ listId: list.id, steam: ID });
    expect(db.prepare("SELECT steam_id FROM users").get().steam_id).toBe(ID);
  });

  it("shows up in the list endpoint like any other game", async () => {
    await importIt({ listId: list.id, steam: ID });
    const res = await client.get(`/api/lists/${list.id}`);
    expect(res.body.games).toHaveLength(3);
  });

  it("is safe to run again: nothing is duplicated", async () => {
    await importIt({ listId: list.id, steam: ID });
    const second = await importIt({ listId: list.id, steam: ID });
    expect(second.body).toMatchObject({ imported: 0, alreadyInList: 3, matched: 3 });
    expect(gamesInList()).toHaveLength(3);
  });

  it("leaves games you already track untouched (your status, rating and notes survive)", async () => {
    const dota = await client.post(`/api/lists/${list.id}/games`).send({ igdb_id: 2963, name: "Dota 2" });
    await client.put(`/api/lists/${list.id}/games/${dota.body.id}`).send({ status: "Completed", rating: 9, notes: "mine" });

    const res = await importIt({ listId: list.id, steam: ID });
    expect(res.body).toMatchObject({ imported: 2, alreadyInList: 1 });
    const kept = db.prepare("SELECT * FROM list_games WHERE igdb_id = 2963").get();
    expect(kept).toMatchObject({ status: "Completed", rating: 9, notes: "mine" });
  });

  it("merges two Steam apps that map to the same IGDB game and adds their hours", async () => {
    owned = { games: [{ appid: 220, name: "Half-Life 2", playtime_forever: 60 }, { appid: 321, name: "Half-Life 2: Edition", playtime_forever: 120 }] };
    const res = await importIt({ listId: list.id, steam: ID });
    expect(res.body).toMatchObject({ owned: 2, matched: 1, imported: 1 });
    expect(gamesInList()[0]).toMatchObject({ igdb_id: 233, hours_played: 3 });
  });

  it("reports how many games had no IGDB match, with a sample of at most 20 names", async () => {
    owned = { games: Array.from({ length: 30 }, (_, i) => ({ appid: 900000 + i, name: `Unknown ${i}`, playtime_forever: 0 })) };
    const res = await importIt({ listId: list.id, steam: ID });
    expect(res.body).toMatchObject({ owned: 30, matched: 0, imported: 0, unmatched: 30 });
    expect(res.body.unmatchedSample).toHaveLength(20);
  });

  it("works for a guest with no account", async () => {
    const guest = newClient(app);
    const guestList = await createList(guest, "Guest shelf");
    const res = await importIt({ listId: guestList.id, steam: ID }, guest);
    expect(res.status).toBe(200);
    expect(res.body.imported).toBe(3);
  });
});

describe("what the user types", () => {
  it.each([
    ["a 17-digit Steam ID", ID],
    ["a profile link with an ID", `https://steamcommunity.com/profiles/${ID}/`],
  ])("accepts %s without calling the vanity endpoint", async (label, steam) => {
    const res = await importIt({ listId: list.id, steam });
    expect(res.status).toBe(200);
    expect(steamCalls.some((u) => u.pathname.includes("ResolveVanityURL"))).toBe(false);
    expect(steamCalls.find((u) => u.pathname.includes("GetOwnedGames")).searchParams.get("steamid")).toBe(ID);
  });

  it.each([["a custom name", "gaben"], ["a custom profile link", "https://steamcommunity.com/id/gaben/"]])(
    "resolves %s to a Steam ID first",
    async (label, steam) => {
      const res = await importIt({ listId: list.id, steam });
      expect(res.status).toBe(200);
      expect(steamCalls[0].pathname).toBe("/ISteamUser/ResolveVanityURL/v1/");
      expect(steamCalls[0].searchParams.get("vanityurl")).toBe("gaben");
      expect(steamCalls[1].searchParams.get("steamid")).toBe(ID);
    }
  );

  it("answers 404 for a custom name that does not exist", async () => {
    const res = await importIt({ listId: list.id, steam: "nobody-by-this-name" });
    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/couldn't find that Steam profile/);
    expect(gamesInList()).toHaveLength(0);
  });

  it.each([[{ steam: "" }], [{ steam: "has space" }], [{ steam: 42 }], [{}], [{ steam: "https://example.com/id/x" }]])(
    "answers 400 for input %j without calling Steam",
    async (body) => {
      const res = await importIt({ listId: list.id, ...body });
      expect(res.status).toBe(400);
      expect(steamCalls).toHaveLength(0);
    }
  );
});

describe("profiles Steam will not show", () => {
  it("explains how to make game details public", async () => {
    owned = {};
    const res = await importIt({ listId: list.id, steam: ID });
    expect(res.status).toBe(422);
    expect(res.body.error).toMatch(/Game details to Public/);
    expect(gamesInList()).toHaveLength(0);
  });

  it("says so for an account with no games", async () => {
    owned = { game_count: 0 };
    const res = await importIt({ listId: list.id, steam: ID });
    expect(res.status).toBe(422);
    expect(res.body.error).toMatch(/no games/);
  });
});

describe("who may import where", () => {
  it("answers 404 for a list that does not exist", async () => {
    expect((await importIt({ listId: 99999, steam: ID })).status).toBe(404);
    expect(steamCalls).toHaveLength(0);
  });

  it("answers 404 for someone else's list, and does not touch Steam", async () => {
    const intruder = newClient(app);
    await createList(intruder, "Mine");
    const res = await importIt({ listId: list.id, steam: ID }, intruder);
    expect(res.status).toBe(404);
    expect(steamCalls).toHaveLength(0);
    expect(gamesInList()).toHaveLength(0);
  });

  it("answers 404 for a visitor with no session, without creating a guest", async () => {
    const res = await request(app).post("/api/import/steam").send({ listId: list.id, steam: ID });
    expect(res.status).toBe(404);
    expect(res.headers["set-cookie"]).toBeUndefined();
  });

  it.each([[undefined], [null], ["1"], [0], [-1], [1.5]])("answers 400 for listId %j", async (listId) => {
    expect((await importIt({ listId, steam: ID })).status).toBe(400);
  });

  it("answers 503 when the server has no Steam key, without calling Steam", async () => {
    delete process.env.STEAM_API_KEY;
    const res = await importIt({ listId: list.id, steam: ID });
    expect(res.status).toBe(503);
    expect(res.body.error).toMatch(/isn't set up/);
    expect(steamCalls).toHaveLength(0);
  });
});

describe("limits", () => {
  it("imports the most-played games first when the list is nearly full", async () => {
    const insert = db.prepare("INSERT INTO list_games (list_id, igdb_id, name) VALUES (?, ?, 'filler')");
    db.transaction(() => {
      for (let i = 1; i <= LIMITS.gamesPerList - 2; i += 1) insert.run(list.id, 5000000 + i);
    })();

    owned = {
      games: [
        { appid: 220, name: "Half-Life 2", playtime_forever: 10 },
        { appid: 570, name: "Dota 2", playtime_forever: 9000 },
        { appid: 730, name: "Counter-Strike 2", playtime_forever: 500 },
        { appid: 1145360, name: "Hades", playtime_forever: 5 },
      ],
    };
    const res = await importIt({ listId: list.id, steam: ID });
    expect(res.body).toMatchObject({ matched: 4, imported: 2, skippedOverCap: 2 });
    const names = db.prepare("SELECT name FROM list_games WHERE name != 'filler' ORDER BY name").all().map((g) => g.name);
    expect(names).toEqual(["Counter-Strike 2", "Dota 2"]);
  });

  it("asks IGDB in batches of 200 and always filters on the Steam source", async () => {
    owned = { games: Array.from({ length: 450 }, (_, i) => ({ appid: 100000 + i, name: `App ${i}`, playtime_forever: 0 })) };
    await importIt({ listId: list.id, steam: ID });

    expect(igdbQueries).toHaveLength(3);
    expect(igdbQueries.every((q) => q.endpoint === "external_games")).toBe(true);
    expect(igdbQueries.every((q) => q.query.includes("external_game_source = 1 &"))).toBe(true);
    expect(igdbQueries.map((q) => (q.query.match(/"\d+"/g) ?? []).length)).toEqual([200, 200, 50]);
  });

  it("sends only numeric ids to IGDB, never text from Steam or the user", async () => {
    owned = { games: [{ appid: 570, name: 'Evil" ; where id > 0; "', playtime_forever: 0 }] };
    await importIt({ listId: list.id, steam: ID });
    expect(igdbQueries[0].query).not.toMatch(/Evil/);
    expect(igdbQueries[0].query).toMatch(/uid = \("570"\)/);
  });

  it("applies the import rate limit", async () => {
    const res = await importIt({ listId: list.id, steam: ID });
    expect(res.headers["ratelimit-policy"]).toBeDefined();
  });
});

describe("when something upstream fails", () => {
  const KEY_LEAK = new RegExp(KEY);

  it.each([[403], [429], [500]])("answers 502 when Steam says HTTP %i, and keeps the key out of the answer and the logs", async (status) => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("no", { status })));
    const res = await importIt({ listId: list.id, steam: ID });
    expect(res.status).toBe(502);
    expect(res.body.error).toMatch(/Steam isn't responding/);
    expect(JSON.stringify(res.body)).not.toMatch(KEY_LEAK);
    expect(JSON.stringify(console.error.mock.calls)).not.toMatch(KEY_LEAK);
    expect(gamesInList()).toHaveLength(0);
  });

  it("answers 502 when the network call to Steam fails, even if the failure message contains the URL", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url) => Promise.reject(new TypeError(`fetch failed ${url}`))));
    const res = await importIt({ listId: list.id, steam: ID });
    expect(res.status).toBe(502);
    expect(JSON.stringify(res.body)).not.toMatch(KEY_LEAK);
    expect(JSON.stringify(console.error.mock.calls)).not.toMatch(KEY_LEAK);
  });

  it("logs the kind of failure, but never the request", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("no", { status: 403 })));
    await importIt({ listId: list.id, steam: ID });
    expect(console.error).toHaveBeenCalledWith("Steam import failed: unavailable (upstream 403)");
  });

  it("answers 502 when IGDB fails, and adds nothing to the list", async () => {
    vi.mocked(igdbRequest).mockRejectedValue(new Error("IGDB request failed: 500"));
    const res = await importIt({ listId: list.id, steam: ID });
    expect(res.status).toBe(502);
    expect(res.body.error).toMatch(/IGDB isn't responding/);
    expect(gamesInList()).toHaveLength(0);
  });

  it("does not half-import when IGDB fails on a later batch", async () => {
    // 450 distinct apps means 3 IGDB batches; the first batch matches a game, the second fails.
    owned = { games: [{ appid: 570, name: "Dota 2", playtime_forever: 0 }] };
    for (let i = 0; i < 449; i += 1) owned.games.push({ appid: 700000 + i, name: `X${i}`, playtime_forever: 0 });
    let call = 0;
    vi.mocked(igdbRequest).mockImplementation(async () => {
      call += 1;
      if (call === 2) throw new Error("IGDB down");
      return [{ uid: "570", game: { id: 2963, name: "Dota 2" } }];
    });
    const res = await importIt({ listId: list.id, steam: ID });
    expect(res.status).toBe(502);
    expect(gamesInList()).toHaveLength(0);
  });
});
