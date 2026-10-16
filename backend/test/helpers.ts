import request from "supertest";
import type { Express } from "express";
import db from "../src/db.ts";
import type { ListGameRow, ListRow } from "../src/types.ts";

// A test visitor: an agent keeps cookies between requests, like a browser tab does.
export type Client = ReturnType<typeof request.agent>;

export function resetDb(): void {
  db.exec("DELETE FROM list_games; DELETE FROM lists; DELETE FROM sessions; DELETE FROM users;");
}

export function newClient(app: Express): Client {
  return request.agent(app);
}

export async function createList(client: Client, name = "Main"): Promise<ListRow> {
  const res = await client.post("/api/lists").send({ name });
  return res.body as ListRow;
}

export async function addGame(client: Client, listId: number, overrides: Partial<ListGameRow> = {}): Promise<ListGameRow> {
  const game = { igdb_id: 1, name: "Hades", cover_url: "https://example.com/c.jpg", ...overrides };
  const res = await client.post(`/api/lists/${listId}/games`).send(game);
  return res.body as ListGameRow;
}

// Test-only shortcuts for reading the database directly. Tests check values with expect(), so a row whose fields are
// unknown is enough; a test that needs a precise type passes it as T.
type Row = Record<string, unknown>;

export function dbGet<T = Row>(sql: string, ...params: unknown[]): T {
  return db.prepare<unknown[], T>(sql).get(...params) as T;
}

export function dbAll<T = Row>(sql: string, ...params: unknown[]): T[] {
  return db.prepare<unknown[], T>(sql).all(...params);
}
