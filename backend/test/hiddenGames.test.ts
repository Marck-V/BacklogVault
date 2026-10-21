import type { ListGameRow, ListRow } from "../src/types.ts";
import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("../src/igdbClient.ts", () => ({ igdbRequest: vi.fn() }));

import app from "../src/app.ts";
import db from "../src/db.ts";
import { igdbRequest } from "../src/igdbClient.ts";
import { resetDb, newClient, createList, addGame, type Client, dbGet } from "./helpers.ts";

let client: Client;
let list: ListRow;
let games: ListGameRow[];

const hide = (game, hidden = true, agent = client, listId = list.id) =>
  agent.put(`/api/lists/${listId}/games/${game.id}/hidden`).send({ hidden });
// The game ids the last time-to-beat lookup asked IGDB about.
const askedIds = () => vi.mocked(igdbRequest).mock.calls.at(-1)![1].match(/\(([\d,]+)\)/)![1]!.split(",").map(Number).sort();
const row = (id) => dbGet("SELECT * FROM list_games WHERE id = ?", id);

beforeEach(async () => {
  resetDb();
  client = newClient(app);
  vi.mocked(igdbRequest).mockReset();
  list = await createList(client);
  games = [];
  for (const igdb_id of [1, 2, 3]) games.push(await addGame(client, list.id, { igdb_id, name: `Game ${igdb_id}` }));
});

describe("PUT /api/lists/:id/games/:gameId/hidden", () => {
  it("hides a game without deleting it, and shows it again", async () => {
    const res = await hide(games[0]);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: games[0].id, hidden: 1 });
    expect(row(games[0].id)).toMatchObject({ name: "Game 1", status: "Backlog", hidden: 1 });

    const listed = (await client.get(`/api/lists/${list.id}`)).body.games;
    expect(listed.map((g) => g.id)).toContain(games[0].id);
    expect(listed.find((g) => g.id === games[0].id).hidden).toBe(1);

    expect((await hide(games[0], false)).body.hidden).toBe(0);
  });

  it("keeps rating, hours and notes while hidden", async () => {
    await client.put(`/api/lists/${list.id}/games/${games[0].id}`).send({ status: "Completed", rating: 9, hoursPlayed: 12, notes: "Keep" });
    await hide(games[0]);
    expect(row(games[0].id)).toMatchObject({ status: "Completed", rating: 9, hours_played: 12, notes: "Keep" });
  });

  it("rejects a non-boolean value", async () => {
    const res = await client.put(`/api/lists/${list.id}/games/${games[0].id}/hidden`).send({ hidden: "yes" });
    expect(res.status).toBe(400);
    expect(row(games[0].id).hidden).toBe(0);
  });

  it("404s for a game that is not in the list, and for someone else's list", async () => {
    expect((await hide({ id: 99999 })).status).toBe(404);
    const other = newClient(app);
    await createList(other, "Theirs");
    expect((await hide(games[0], true, other)).status).toBe(404);
    expect(row(games[0].id).hidden).toBe(0);
  });
});

describe("PATCH /api/lists/:id/games with hidden", () => {
  it("hides and shows several games at once without touching their status", async () => {
    await client.put(`/api/lists/${list.id}/games/${games[1].id}`).send({ status: "Playing" });
    const res = await client.patch(`/api/lists/${list.id}/games`).send({ ids: [games[0].id, games[1].id], hidden: true });
    expect(res.status).toBe(200);
    expect(res.body.updated).toBe(2);
    expect(row(games[0].id).hidden).toBe(1);
    expect(row(games[1].id).hidden).toBe(1);
    expect(row(games[1].id).status).toBe("Playing");
    expect(row(games[2].id).hidden).toBe(0);

    await client.patch(`/api/lists/${list.id}/games`).send({ ids: [games[0].id], hidden: false });
    expect(row(games[0].id).hidden).toBe(0);
  });

  it("still needs a status or hidden", async () => {
    const res = await client.patch(`/api/lists/${list.id}/games`).send({ ids: [games[0].id] });
    expect(res.status).toBe(400);
  });
});

describe("hidden games are left out of the dashboard numbers", () => {
  it("time-to-beat: counts, hours and totals ignore them", async () => {
    await client.put(`/api/lists/${list.id}/games/${games[0].id}`).send({ status: "Backlog", hoursPlayed: 10 });
    await client.put(`/api/lists/${list.id}/games/${games[1].id}`).send({ status: "Completed" });
    vi.mocked(igdbRequest).mockImplementation(async (_e, query) => {
      const ids = query.match(/\(([\d,]+)\)/)![1]!.split(",").map(Number);
      return ids.map((game_id) => ({ game_id, normally: 3600 * 10, completely: 3600 * 20 }));
    });

    const before = (await client.get("/api/stats/time-to-beat")).body;
    expect(before).toMatchObject({ game_count: 2, completed_count: 1, total_hours_played: 10, total_main_story_seconds: 72000 });
    expect(vi.mocked(igdbRequest)).toHaveBeenCalledTimes(1);

    await hide(games[0]);
    await hide(games[1]);
    const after = (await client.get("/api/stats/time-to-beat")).body;
    expect(after).toMatchObject({ game_count: 1, completed_count: 0, total_hours_played: 0, total_main_story_seconds: 36000 });
    // The estimates were saved on the first load, so hiding games needs no further IGDB request.
    expect(vi.mocked(igdbRequest)).toHaveBeenCalledTimes(1);

    await hide(games[0], false);
    expect((await client.get("/api/stats/time-to-beat")).body.total_hours_played).toBe(10);
  });

  it("a game hidden in one list still counts through another list where it is visible", async () => {
    const second = await createList(client, "Second");
    await addGame(client, second.id, { igdb_id: 1, name: "Game 1" });
    await hide(games[0]);
    vi.mocked(igdbRequest).mockResolvedValue([]);
    await client.get("/api/stats/time-to-beat");
    expect(askedIds()).toEqual([1, 2, 3]);
  });

  it("currently playing (by hand) ignores hidden games", async () => {
    await client.put(`/api/lists/${list.id}/games/${games[0].id}`).send({ status: "Playing" });
    await client.put(`/api/lists/${list.id}/games/${games[1].id}`).send({ status: "Playing" });
    await hide(games[0]);
    const res = await client.get("/api/stats/currently-playing");
    expect(res.body.games.map((g) => g.igdb_id)).toEqual([2]);
  });

  it("the genre breakdown does not ask about hidden games", async () => {
    vi.mocked(igdbRequest).mockResolvedValue([]);
    await hide(games[0]);
    const res = await client.get("/api/stats/breakdown");
    expect(res.body.game_count).toBe(2);
  });
});

describe("hidden games and backups", () => {
  it("a backup keeps the hidden flag and a restore puts it back", async () => {
    await hide(games[0]);
    const file = (await client.get("/api/library/backup")).body;
    expect(file.lists[0].games.find((g) => g.igdb_id === 1).hidden).toBe(1);

    const fresh = newClient(app);
    expect((await fresh.post("/api/library/restore").send(file)).status).toBe(200);
    const again = (await fresh.get("/api/library/backup")).body;
    expect(again.lists[0].games.map((g) => [g.igdb_id, g.hidden]).sort()).toEqual([[1, 1], [2, 0], [3, 0]]);
  });

  it("an older backup without the flag restores as not hidden", async () => {
    const file = (await client.get("/api/library/backup")).body;
    for (const g of file.lists[0].games) delete g.hidden;
    const fresh = newClient(app);
    expect((await fresh.post("/api/library/restore").send(file)).status).toBe(200);
    const again = (await fresh.get("/api/library/backup")).body;
    expect(again.lists[0].games.every((g) => g.hidden === 0)).toBe(true);
  });
});
