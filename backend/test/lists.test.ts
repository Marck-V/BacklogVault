import type { ListGameRow, ListRow } from "../src/types.ts";
import { describe, it, expect, beforeEach } from "vitest";
import app from "../src/app.ts";
import db from "../src/db.ts";
import { resetDb, newClient, createList, addGame, type Client, dbGet } from "./helpers.ts";

let client: Client;
beforeEach(() => {
  resetDb();
  client = newClient(app);
});

describe("lists", () => {
  it("returns an empty array when there are no lists", async () => {
    const res = await client.get("/api/lists");
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it("creates a list and trims the name", async () => {
    const res = await client.post("/api/lists").send({ name: "  Backlog 2026  " });
    expect(res.status).toBe(201);
    expect(res.body.name).toBe("Backlog 2026");
    expect(res.body.id).toBeTypeOf("number");
  });

  it.each([[{}], [{ name: "" }], [{ name: "   " }]])("rejects invalid list body %j", async (body) => {
    const res = await client.post("/api/lists").send(body);
    expect(res.status).toBe(400);
  });

  it("returns 404 for an unknown list", async () => {
    const res = await client.get("/api/lists/9999");
    expect(res.status).toBe(404);
  });

  it("returns a list together with its games", async () => {
    const list = await createList(client);
    await addGame(client, list.id, { igdb_id: 1, name: "Hades" });
    const res = await client.get(`/api/lists/${list.id}`);
    expect(res.status).toBe(200);
    expect(res.body.games).toHaveLength(1);
    expect(res.body.games[0].name).toBe("Hades");
  });

  it("deleting a list also deletes its games (cascade)", async () => {
    const list = await createList(client);
    await addGame(client, list.id);
    const del = await client.delete(`/api/lists/${list.id}`);
    expect(del.status).toBe(204);
    const { n } = dbGet("SELECT COUNT(*) AS n FROM list_games");
    expect(n).toBe(0);
  });
});

describe("adding games", () => {
  it("adds a game with status Backlog by default", async () => {
    const list = await createList(client);
    const res = await client
      .post(`/api/lists/${list.id}/games`)
      .send({ igdb_id: 1, name: "Hades" });
    expect(res.status).toBe(201);
    expect(res.body.status).toBe("Backlog");
    expect(res.body.cover_url).toBeNull();
  });

  it("ignores a client-supplied status on creation", async () => {
    const list = await createList(client);
    const res = await client
      .post(`/api/lists/${list.id}/games`)
      .send({ igdb_id: 1, name: "Hades", status: "Completed" });
    expect(res.body.status).toBe("Backlog");
  });

  it.each([[{ name: "Hades" }], [{ igdb_id: 1 }], [{}]])("rejects missing fields %j", async (body) => {
    const list = await createList(client);
    const res = await client.post(`/api/lists/${list.id}/games`).send(body);
    expect(res.status).toBe(400);
  });

  it("returns 404 when the list does not exist", async () => {
    const res = await client.post("/api/lists/9999/games").send({ igdb_id: 1, name: "Hades" });
    expect(res.status).toBe(404);
  });

  it("rejects a duplicate game in the same list with 409", async () => {
    const list = await createList(client);
    await addGame(client, list.id, { igdb_id: 1 });
    const res = await client
      .post(`/api/lists/${list.id}/games`)
      .send({ igdb_id: 1, name: "Hades" });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/already in this list/i);
  });

  it("allows the same game in two different lists", async () => {
    const a = await createList(client, "A");
    const b = await createList(client, "B");
    const first = await client.post(`/api/lists/${a.id}/games`).send({ igdb_id: 1, name: "Hades" });
    const second = await client.post(`/api/lists/${b.id}/games`).send({ igdb_id: 1, name: "Hades" });
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
  });
});

describe("updating a game entry", () => {
  let list: ListRow;
  let game: ListGameRow;

  beforeEach(async () => {
    list = await createList(client);
    game = await addGame(client, list.id);
  });

  const put = (body) => client.put(`/api/lists/${list.id}/games/${game.id}`).send(body);

  it("rejects an invalid status", async () => {
    const res = await put({ status: "Not Playing" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/status must be one of/);
  });

  it.each(["Backlog", "Playing"])("rejects a rating while status is %s", async (status) => {
    const res = await put({ status, rating: 8 });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Completed or Dropped/);
  });

  it.each([0, 11, 5.5, "9"])("rejects out-of-range or non-integer rating %j", async (rating) => {
    const res = await put({ status: "Completed", rating });
    expect(res.status).toBe(400);
  });

  it.each(["Completed", "Dropped"])("accepts a rating when status is %s", async (status) => {
    const res = await put({ status, rating: 9 });
    expect(res.status).toBe(200);
    expect(res.body.rating).toBe(9);
  });

  it("returns 404 for a game that is not in the list", async () => {
    const res = await client.put(`/api/lists/${list.id}/games/9999`).send({ status: "Playing" });
    expect(res.status).toBe(404);
  });

  it("returns 404 when the game belongs to a different list", async () => {
    const other = await createList(client, "Other");
    const res = await client.put(`/api/lists/${other.id}/games/${game.id}`).send({ status: "Playing" });
    expect(res.status).toBe(404);
  });

  it("stamps date_completed on the server when status becomes Completed", async () => {
    const before = Date.now();
    const res = await put({ status: "Completed", dateCompleted: "1999-01-01" });
    const stamped = new Date(res.body.date_completed).getTime();
    expect(stamped).toBeGreaterThanOrEqual(before - 1000);
    expect(stamped).toBeLessThanOrEqual(Date.now() + 1000);
  });

  it("does not stamp date_completed for other statuses", async () => {
    const res = await put({ status: "Playing" });
    expect(res.body.date_completed).toBeNull();
  });

  it("keeps date_completed when status moves away from Completed", async () => {
    const completed = await put({ status: "Completed" });
    const replay = await put({ status: "Playing" });
    expect(replay.body.date_completed).toBe(completed.body.date_completed);
  });

  it("keeps existing rating, hours and notes when a later update omits them", async () => {
    await put({ status: "Completed", rating: 9, hoursPlayed: 42.5, notes: "great" });
    const res = await put({ status: "Dropped" });
    expect(res.body.rating).toBe(9);
    expect(res.body.hours_played).toBe(42.5);
    expect(res.body.notes).toBe("great");
  });
});

describe("removing a game", () => {
  it("removes only that game", async () => {
    const list = await createList(client);
    const keep = await addGame(client, list.id, { igdb_id: 1 });
    const drop = await addGame(client, list.id, { igdb_id: 2, name: "Other" });
    const res = await client.delete(`/api/lists/${list.id}/games/${drop.id}`);
    expect(res.status).toBe(204);
    const remaining = await client.get(`/api/lists/${list.id}`);
    expect(remaining.body.games.map((g) => g.id)).toEqual([keep.id]);
  });
});
