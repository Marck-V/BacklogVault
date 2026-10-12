import { describe, it, expect, beforeEach } from "vitest";
import app from "../src/app.js";
import db from "../src/db.js";
import { LIMITS } from "../src/limits.js";
import { resetDb, newClient, createList, addGame } from "./helpers.js";

let client;
let list;
let games;

const bulk = (body, agent = client, listId = list.id) => agent.patch(`/api/lists/${listId}/games`).send(body);
const row = (id) => db.prepare("SELECT * FROM list_games WHERE id = ?").get(id);

beforeEach(async () => {
  resetDb();
  client = newClient(app);
  list = await createList(client);
  games = [];
  for (const igdb_id of [1, 2, 3, 4]) games.push(await addGame(client, list.id, { igdb_id, name: `Game ${igdb_id}` }));
});

describe("PATCH /api/lists/:id/games (change several statuses at once)", () => {
  it("changes the status of every selected game and leaves the others alone", async () => {
    const res = await bulk({ ids: [games[0].id, games[2].id], status: "Playing" });
    expect(res.status).toBe(200);
    expect(res.body.updated).toBe(2);
    expect(res.body.games.map((g) => g.id).sort()).toEqual([games[0].id, games[2].id].sort());
    expect(res.body.games.every((g) => g.status === "Playing")).toBe(true);

    expect(row(games[0].id).status).toBe("Playing");
    expect(row(games[2].id).status).toBe("Playing");
    expect(row(games[1].id).status).toBe("Backlog");
    expect(row(games[3].id).status).toBe("Backlog");
  });

  it("stamps the completion date for newly completed games, like a single update does", async () => {
    const res = await bulk({ ids: [games[0].id, games[1].id], status: "Completed" });
    expect(res.status).toBe(200);
    for (const g of res.body.games) expect(Date.parse(g.date_completed)).not.toBeNaN();
  });

  it("does not re-stamp a game that was already completed", async () => {
    await bulk({ ids: [games[0].id], status: "Completed" });
    db.prepare("UPDATE list_games SET date_completed = '2020-01-01T00:00:00.000Z' WHERE id = ?").run(games[0].id);

    await bulk({ ids: [games[0].id, games[1].id], status: "Completed" });
    expect(row(games[0].id).date_completed).toBe("2020-01-01T00:00:00.000Z");
    expect(row(games[1].id).date_completed).not.toBeNull();
  });

  it("keeps the completion date when a game moves away from Completed", async () => {
    await bulk({ ids: [games[0].id], status: "Completed" });
    const stamped = row(games[0].id).date_completed;
    await bulk({ ids: [games[0].id], status: "Backlog" });
    expect(row(games[0].id).date_completed).toBe(stamped);
  });

  it("changes only the status: rating, hours and notes survive", async () => {
    await client.put(`/api/lists/${list.id}/games/${games[0].id}`).send({ status: "Completed", rating: 9, hoursPlayed: 12.5, notes: "Great" });
    await bulk({ ids: [games[0].id], status: "Dropped" });
    const after = row(games[0].id);
    expect(after).toMatchObject({ status: "Dropped", rating: 9, hours_played: 12.5, notes: "Great" });
  });

  it("counts a repeated id once", async () => {
    const res = await bulk({ ids: [games[0].id, games[0].id, games[0].id], status: "Playing" });
    expect(res.body.updated).toBe(1);
  });

  it("skips ids that are not in this list and says how many it changed", async () => {
    const other = await createList(client, "Other");
    const elsewhere = await addGame(client, other.id, { igdb_id: 99 });

    const res = await bulk({ ids: [games[0].id, elsewhere.id, 987654], status: "Playing" });
    expect(res.status).toBe(200);
    expect(res.body.updated).toBe(1);
    expect(row(elsewhere.id).status).toBe("Backlog");
  });

  it("returns 404 when none of the games are in the list", async () => {
    const res = await bulk({ ids: [987654], status: "Playing" });
    expect(res.status).toBe(404);
  });

  it("returns 404 for an unknown list", async () => {
    expect((await bulk({ ids: [games[0].id], status: "Playing" }, client, 99999)).status).toBe(404);
  });

  it("treats someone else's list as not found and changes nothing", async () => {
    const stranger = newClient(app);
    await createList(stranger, "Theirs"); // the stranger now has a session
    const res = await bulk({ ids: [games[0].id], status: "Completed" }, stranger);
    expect(res.status).toBe(404);
    expect(row(games[0].id).status).toBe("Backlog");
  });

  it("needs a session", async () => {
    expect((await bulk({ ids: [games[0].id], status: "Playing" }, newClient(app))).status).toBe(404);
  });

  it.each([
    ["an unknown status", { ids: [1], status: "Finished" }],
    ["no status", { ids: [1] }],
    ["no ids", { status: "Playing" }],
    ["an empty list of ids", { ids: [], status: "Playing" }],
    ["ids that are not an array", { ids: "1,2", status: "Playing" }],
    ["a non-integer id", { ids: [1.5], status: "Playing" }],
    ["a text id", { ids: ["1"], status: "Playing" }],
    ["a zero or negative id", { ids: [0, -3], status: "Playing" }],
    ["too many ids", { ids: Array.from({ length: LIMITS.gamesPerList + 1 }, (_, i) => i + 1), status: "Playing" }],
  ])("rejects %s", async (_label, body) => {
    const res = await bulk(body);
    expect(res.status).toBe(400);
    expect(res.body.error).toBeTruthy();
    for (const g of games) expect(row(g.id).status).toBe("Backlog");
  });

  it("is all or nothing for a valid request: every found game changes together", async () => {
    const res = await bulk({ ids: games.map((g) => g.id), status: "Dropped" });
    expect(res.body.updated).toBe(4);
    expect(db.prepare("SELECT COUNT(*) AS n FROM list_games WHERE status = 'Dropped'").get().n).toBe(4);
  });
});
