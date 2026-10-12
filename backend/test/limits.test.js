import { describe, it, expect, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import app from "../src/app.js";
import db from "../src/db.js";
import { LIMITS } from "../src/limits.js";
import { createWriteLimiter, createGuestLimiter } from "../src/writeLimiters.js";
import { resetDb, newClient, createList, addGame } from "./helpers.js";

let client;
beforeEach(() => {
  resetDb();
  client = newClient(app);
});

describe("list names", () => {
  it(`accepts a name of exactly ${LIMITS.listName} characters and rejects one character more`, async () => {
    expect((await client.post("/api/lists").send({ name: "a".repeat(LIMITS.listName) })).status).toBe(201);
    const tooLong = await client.post("/api/lists").send({ name: "a".repeat(LIMITS.listName + 1) });
    expect(tooLong.status).toBe(400);
    expect(tooLong.body.error).toMatch(/at most 100 characters/);
  });

  it("measures the length after trimming", async () => {
    const padded = ` ${"a".repeat(LIMITS.listName)} `;
    const res = await client.post("/api/lists").send({ name: padded });
    expect(res.status).toBe(201);
    expect(res.body.name).toBe("a".repeat(LIMITS.listName));
  });
});

describe("how many lists and games one account can hold", () => {
  it(`stops at ${LIMITS.listsPerUser} lists and allows another after one is deleted`, async () => {
    let last;
    for (let i = 0; i < LIMITS.listsPerUser; i += 1) last = await client.post("/api/lists").send({ name: `List ${i}` });
    expect(last.status).toBe(201);

    const over = await client.post("/api/lists").send({ name: "One too many" });
    expect(over.status).toBe(409);
    expect(over.body.error).toMatch(/at most 50 lists/);

    await client.delete(`/api/lists/${last.body.id}`);
    expect((await client.post("/api/lists").send({ name: "Fits again" })).status).toBe(201);
  });

  it("counts lists per user, so one user's lists do not use up another's allowance", async () => {
    for (let i = 0; i < LIMITS.listsPerUser; i += 1) await client.post("/api/lists").send({ name: `L${i}` });
    expect((await newClient(app).post("/api/lists").send({ name: "Someone else" })).status).toBe(201);
  });

  it(`stops at ${LIMITS.gamesPerList} games in one list`, async () => {
    const list = await createList(client);
    const insert = db.prepare("INSERT INTO list_games (list_id, igdb_id, name) VALUES (?, ?, 'filler')");
    db.transaction(() => {
      for (let i = 1; i < LIMITS.gamesPerList; i += 1) insert.run(list.id, i);
    })();

    const last = await client.post(`/api/lists/${list.id}/games`).send({ igdb_id: 900001, name: "Last one that fits" });
    expect(last.status).toBe(201);

    const over = await client.post(`/api/lists/${list.id}/games`).send({ igdb_id: 900002, name: "One too many" });
    expect(over.status).toBe(409);
    expect(over.body.error).toMatch(/at most 2000 games/);
  });
});

describe("game fields", () => {
  let list;
  beforeEach(async () => {
    list = await createList(client);
  });
  const add = (body) => client.post(`/api/lists/${list.id}/games`).send(body);

  it.each([["1"], [0], [-5], [1.5], [null], [true], [{}]])("rejects igdb_id %j", async (igdb_id) => {
    expect((await add({ igdb_id, name: "Hades" })).status).toBe(400);
  });

  it.each([[""], ["   "], [42], [null], [["Hades"]]])("rejects name %j", async (name) => {
    expect((await add({ igdb_id: 1, name })).status).toBe(400);
  });

  it(`accepts a name of ${LIMITS.gameName} characters, rejects longer, and trims`, async () => {
    expect((await add({ igdb_id: 1, name: "n".repeat(LIMITS.gameName) })).status).toBe(201);
    expect((await add({ igdb_id: 2, name: "n".repeat(LIMITS.gameName + 1) })).status).toBe(400);
    const trimmed = await add({ igdb_id: 3, name: "  Hades  " });
    expect(trimmed.body.name).toBe("Hades");
  });

  it.each([
    ["http://insecure.example/c.jpg"],
    ["javascript:alert(1)"],
    ["//images.igdb.com/c.jpg"],
    [42],
    [`https://x.example/${"a".repeat(LIMITS.coverUrl)}`],
  ])("rejects cover_url %j", async (cover_url) => {
    expect((await add({ igdb_id: 1, name: "Hades", cover_url })).status).toBe(400);
  });

  it.each([[undefined], [null], ["https://images.igdb.com/igdb/image/upload/t_cover_big/co1.jpg"]])(
    "accepts cover_url %j",
    async (cover_url) => {
      expect((await add({ igdb_id: 1, name: "Hades", cover_url })).status).toBe(201);
    }
  );
});

describe("notes and hours when updating", () => {
  let list;
  let game;
  beforeEach(async () => {
    list = await createList(client);
    game = await addGame(client, list.id);
  });
  const put = (body) => client.put(`/api/lists/${list.id}/games/${game.id}`).send({ status: "Playing", ...body });

  it(`accepts notes up to ${LIMITS.notes} characters and rejects more or non-text`, async () => {
    expect((await put({ notes: "n".repeat(LIMITS.notes) })).status).toBe(200);
    expect((await put({ notes: "n".repeat(LIMITS.notes + 1) })).status).toBe(400);
    expect((await put({ notes: 12345 })).status).toBe(400);
    expect((await put({ notes: { a: 1 } })).status).toBe(400);
  });

  it.each([[0], [12.5], [LIMITS.maxHours]])("accepts hoursPlayed %j", async (hoursPlayed) => {
    const res = await put({ hoursPlayed });
    expect(res.status).toBe(200);
    expect(res.body.hours_played).toBe(hoursPlayed);
  });

  it.each([[-1], [LIMITS.maxHours + 1], ["5"], [true], [[1]]])("rejects hoursPlayed %j", async (hoursPlayed) => {
    expect((await put({ hoursPlayed })).status).toBe(400);
  });
});

describe("createWriteLimiter", () => {
  it("counts changes but never reads", async () => {
    const tiny = express();
    tiny.use(createWriteLimiter(2));
    tiny.get("/x", (req, res) => res.json({ ok: true }));
    tiny.post("/x", (req, res) => res.json({ ok: true }));
    tiny.delete("/x", (req, res) => res.json({ ok: true }));

    for (let i = 0; i < 20; i += 1) expect((await request(tiny).get("/x")).status).toBe(200);
    expect((await request(tiny).post("/x")).status).toBe(200);
    expect((await request(tiny).delete("/x")).status).toBe(200);
    const blocked = await request(tiny).post("/x");
    expect(blocked.status).toBe(429);
    expect(blocked.body.error).toMatch(/too many changes/i);
    expect((await request(tiny).get("/x")).status).toBe(200);
  });
});

describe("createGuestLimiter", () => {
  function tinyApp(limit) {
    const tiny = express();
    // The real app sets req.user from the session cookie; here a header stands in for "has a session".
    tiny.use((req, res, next) => {
      req.user = req.headers["x-has-session"] ? { id: 1 } : null;
      next();
    });
    tiny.use(createGuestLimiter(limit));
    tiny.post("/x", (req, res) => res.json({ ok: true }));
    return tiny;
  }

  it("limits requests that would start a new guest session", async () => {
    const tiny = tinyApp(3);
    for (let i = 0; i < 3; i += 1) expect((await request(tiny).post("/x")).status).toBe(200);
    const blocked = await request(tiny).post("/x");
    expect(blocked.status).toBe(429);
    expect(blocked.body.error).toMatch(/new sessions/i);
  });

  it("does not count people who already have a session", async () => {
    const tiny = tinyApp(1);
    for (let i = 0; i < 10; i += 1) {
      expect((await request(tiny).post("/x").set("X-Has-Session", "1")).status).toBe(200);
    }
    expect((await request(tiny).post("/x")).status).toBe(200);
  });
});

describe("limiter wiring in the real app", () => {
  it("sends rate limit headers on a change, but not on a read", async () => {
    const list = await createList(client);
    const write = await client.post(`/api/lists/${list.id}/games`).send({ igdb_id: 1, name: "Hades" });
    const read = await client.get("/api/lists");
    expect(write.headers["ratelimit-policy"]).toBeDefined();
    expect(read.headers["ratelimit-policy"]).toBeUndefined();
  });

  it("applies the guest limiter to a visitor without a session", async () => {
    const res = await request(app).post("/api/lists").send({ name: "First visit" });
    expect(res.headers["ratelimit-policy"]).toBeDefined();
  });
});
