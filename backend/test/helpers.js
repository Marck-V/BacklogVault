import request from "supertest";
import db from "../src/db.js";

export function resetDb() {
  db.exec("DELETE FROM list_games; DELETE FROM lists; DELETE FROM sessions; DELETE FROM users;");
}

// An agent keeps cookies between requests, like a browser tab does.
export function newClient(app) {
  return request.agent(app);
}

export async function createList(client, name = "Main") {
  const res = await client.post("/api/lists").send({ name });
  return res.body;
}

export async function addGame(client, listId, overrides = {}) {
  const game = { igdb_id: 1, name: "Hades", cover_url: "https://example.com/c.jpg", ...overrides };
  const res = await client.post(`/api/lists/${listId}/games`).send(game);
  return res.body;
}
