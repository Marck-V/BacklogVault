import { describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import app from "../src/app.js";
import db from "../src/db.js";
import { resetDb, newClient, createList, addGame } from "./helpers.js";

let client;
beforeEach(() => {
  resetDb();
  client = newClient(app);
});

describe("GET /api/library", () => {
  it("is refused without a session, and does not create a guest", async () => {
    const res = await client.get("/api/library");
    expect(res.status).toBe(401);
    expect(res.headers["set-cookie"]).toBeUndefined();
    expect(db.prepare("SELECT COUNT(*) AS n FROM users").get().n).toBe(0);
  });

  it("returns an empty library for a signed-in user with no lists", async () => {
    const list = await createList(client);
    await client.delete(`/api/lists/${list.id}`);
    const res = await client.get("/api/library");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ lists: [] });
  });

  it("returns lists ordered by name, each with its games newest first", async () => {
    const zed = await createList(client, "Zed");
    const alpha = await createList(client, "Alpha");
    const older = await addGame(client, alpha.id, { igdb_id: 1, name: "Older" });
    const newer = await addGame(client, alpha.id, { igdb_id: 2, name: "Newer" });
    await addGame(client, zed.id, { igdb_id: 3, name: "In Zed" });
    db.prepare("UPDATE list_games SET added_at = ? WHERE id = ?").run("2026-01-01 00:00:00", older.id);
    db.prepare("UPDATE list_games SET added_at = ? WHERE id = ?").run("2026-02-01 00:00:00", newer.id);

    const { body } = await client.get("/api/library");
    expect(body.lists.map((l) => l.name)).toEqual(["Alpha", "Zed"]);
    expect(body.lists[0].games.map((g) => g.name)).toEqual(["Newer", "Older"]);
    expect(body.lists[1].games.map((g) => g.name)).toEqual(["In Zed"]);
  });

  it("includes the fields the export needs", async () => {
    const list = await createList(client);
    await addGame(client, list.id, { name: "Hades" });
    const { body } = await client.get("/api/library");
    expect(body.lists[0].games[0]).toMatchObject({ name: "Hades", status: "Backlog" });
    expect(body.lists[0].games[0].added_at).toMatch(/^\d{4}-\d{2}-\d{2}/);
  });

  it("only ever returns the signed-in user's own data", async () => {
    const alice = client;
    const bob = newClient(app);
    const aliceList = await createList(alice, "Alice's");
    await addGame(alice, aliceList.id, { igdb_id: 7, name: "Alice Game" });
    const bobList = await createList(bob, "Bob's");
    await addGame(bob, bobList.id, { igdb_id: 7, name: "Bob Game" });

    const a = (await alice.get("/api/library")).body;
    const b = (await bob.get("/api/library")).body;
    expect(a.lists.map((l) => l.name)).toEqual(["Alice's"]);
    expect(a.lists[0].games.map((g) => g.name)).toEqual(["Alice Game"]);
    expect(b.lists.map((l) => l.name)).toEqual(["Bob's"]);
    expect(b.lists[0].games.map((g) => g.name)).toEqual(["Bob Game"]);
  });

  it("rejects a forged cookie", async () => {
    const res = await request(app).get("/api/library").set("Cookie", "bv_session=forged-token");
    expect(res.status).toBe(401);
  });
});
