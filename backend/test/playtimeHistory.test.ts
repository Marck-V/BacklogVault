import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import request from "supertest";

import app from "../src/app.ts";
import db from "../src/db.ts";
import { recordPlaytimeSnapshot, playtimeHistory } from "../src/playtimeHistory.ts";
import { resetDb, newClient, createList, addGame, dbAll, type Client } from "./helpers.ts";

let client: Client;

const userId = () => (db.prepare("SELECT id FROM users LIMIT 1").get() as { id: number }).id;

beforeEach(() => {
  resetDb();
  client = newClient(app);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("daily library totals", () => {
  it("saves hours, games and completed games, counting a game in two lists once", async () => {
    const one = await createList(client, "One");
    const two = await createList(client, "Two");
    const hades = await addGame(client, one.id, { igdb_id: 1, name: "Hades" });
    await client.put(`/api/lists/${one.id}/games/${hades.id}`).send({ status: "Completed", hoursPlayed: 12.5 });
    await addGame(client, two.id, { igdb_id: 1, name: "Hades" });
    const dota = await addGame(client, one.id, { igdb_id: 2, name: "Dota 2" });
    await client.put(`/api/lists/${one.id}/games/${dota.id}`).send({ status: "Backlog", hoursPlayed: 100 });

    recordPlaytimeSnapshot(userId());
    expect(playtimeHistory(userId())).toEqual([
      { day: new Date().toISOString().slice(0, 10), total_hours: 112.5, game_count: 2, completed_count: 1 },
    ]);
  });

  it("leaves hidden games out, like the rest of the dashboard", async () => {
    const list = await createList(client);
    await addGame(client, list.id, { igdb_id: 1 });
    const hidden = await addGame(client, list.id, { igdb_id: 2 });
    await client.put(`/api/lists/${list.id}/games/${hidden.id}`).send({ status: "Backlog", hoursPlayed: 50 });
    await client.put(`/api/lists/${list.id}/games/${hidden.id}/hidden`).send({ hidden: true });

    recordPlaytimeSnapshot(userId());
    expect(playtimeHistory(userId())).toMatchObject([{ total_hours: 0, game_count: 1 }]);
  });

  it("keeps one row per day (the last reading wins) and a new row on a new day", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-01T10:00:00Z"));
    const list = await createList(client);
    const game = await addGame(client, list.id, { igdb_id: 1 });
    recordPlaytimeSnapshot(userId());
    await client.put(`/api/lists/${list.id}/games/${game.id}`).send({ status: "Backlog", hoursPlayed: 5 });
    recordPlaytimeSnapshot(userId());

    vi.setSystemTime(new Date("2026-10-02T10:00:00Z"));
    await client.put(`/api/lists/${list.id}/games/${game.id}`).send({ status: "Backlog", hoursPlayed: 8 });
    recordPlaytimeSnapshot(userId());

    expect(playtimeHistory(userId()).map((s) => [s.day, s.total_hours])).toEqual([
      ["2026-10-01", 5],
      ["2026-10-02", 8],
    ]);
  });

  it("records nothing for an empty library", async () => {
    await createList(client);
    recordPlaytimeSnapshot(userId());
    expect(dbAll("SELECT * FROM playtime_snapshots")).toEqual([]);
  });

  it("is recorded by opening the dashboard", async () => {
    const list = await createList(client);
    await addGame(client, list.id, { igdb_id: 1 });
    await client.get("/api/stats/currently-playing");
    expect(dbAll("SELECT * FROM playtime_snapshots")).toHaveLength(1);
  });

  it("is returned to its owner only, oldest first, and an empty list for a visitor", async () => {
    const list = await createList(client);
    await addGame(client, list.id, { igdb_id: 1 });
    await client.get("/api/stats/currently-playing");
    const mine = userId();
    db.prepare("INSERT INTO playtime_snapshots VALUES (?, ?, 1, 1, 0)").run(mine, "2020-01-01");

    const other = newClient(app);
    const otherList = await createList(other);
    await addGame(other, otherList.id, { igdb_id: 9 });
    await other.get("/api/stats/currently-playing");

    const res = await client.get("/api/stats/history");
    expect(res.body).toHaveLength(2);
    expect(res.body[0].day).toBe("2020-01-01");
    expect((await other.get("/api/stats/history")).body).toHaveLength(1);
    expect((await request(app).get("/api/stats/history")).body).toEqual([]);
  });

  it("is deleted with the account", async () => {
    const list = await createList(client);
    await addGame(client, list.id, { igdb_id: 1 });
    await client.get("/api/stats/currently-playing");
    await client.delete("/api/auth/me").send({ deleteEverything: true });
    expect(dbAll("SELECT * FROM playtime_snapshots")).toEqual([]);
  });
});
