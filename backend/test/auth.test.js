import { describe, it, expect, beforeEach, vi } from "vitest";
import request from "supertest";

vi.mock("../src/igdbClient.js", () => ({ igdbRequest: vi.fn() }));

import app from "../src/app.js";
import db from "../src/db.js";
import { resetDb, newClient, createList, addGame } from "./helpers.js";

const userCount = () => db.prepare("SELECT COUNT(*) AS n FROM users").get().n;
const sessionCookie = (res) => res.headers["set-cookie"]?.find((c) => c.startsWith("bv_session="));
const credentials = { email: "player@example.com", password: "correct horse battery" };

let client;
beforeEach(() => {
  resetDb();
  client = newClient(app);
});

describe("guest sessions", () => {
  it("reports no user and creates nothing for a visitor who has not written anything", async () => {
    const me = await client.get("/api/auth/me");
    const lists = await client.get("/api/lists");
    const playing = await client.get("/api/stats/currently-playing");
    expect(me.body).toEqual({ user: null });
    expect(lists.body).toEqual([]);
    expect(playing.body).toEqual({ source: "manual", steam_linked: false, steam_failed: false, games: [] });
    expect(sessionCookie(me)).toBeUndefined();
    expect(userCount()).toBe(0);
  });

  it("creates a guest on the first write and recognises them afterwards", async () => {
    const res = await client.post("/api/lists").send({ name: "Mine" });
    expect(res.status).toBe(201);
    expect(userCount()).toBe(1);

    const me = await client.get("/api/auth/me");
    expect(me.body.user).toMatchObject({ email: null, isGuest: true });
    await client.post("/api/lists").send({ name: "Second" });
    expect(userCount()).toBe(1);
  });

  it("sets an HttpOnly, SameSite=Lax cookie that is not marked Secure by default", async () => {
    const res = await client.post("/api/lists").send({ name: "Mine" });
    const cookie = sessionCookie(res);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
    expect(cookie).not.toMatch(/Secure/i);
  });

  it("stores only a hash of the session token, never the token itself", async () => {
    const res = await client.post("/api/lists").send({ name: "Mine" });
    const token = sessionCookie(res).split(";")[0].split("=")[1];
    const { token_hash } = db.prepare("SELECT token_hash FROM sessions").get();
    expect(token_hash).not.toBe(token);
    expect(token_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it.each([[{}], [{ name: "" }], [{ name: "   " }], [{ name: 42 }]])(
    "does not create a guest for an invalid request %j",
    async (body) => {
      const res = await client.post("/api/lists").send(body);
      expect(res.status).toBe(400);
      expect(sessionCookie(res)).toBeUndefined();
      expect(userCount()).toBe(0);
    }
  );
});

describe("data isolation between users", () => {
  let alice;
  let bob;
  let list;
  let game;

  beforeEach(async () => {
    alice = client;
    bob = newClient(app);
    list = await createList(alice, "Alice's list");
    game = await addGame(alice, list.id);
    await alice.put(`/api/lists/${list.id}/games/${game.id}`).send({ status: "Playing" });
    await createList(bob, "Bob's list");
  });

  it("only returns your own lists", async () => {
    const res = await bob.get("/api/lists");
    expect(res.body.map((l) => l.name)).toEqual(["Bob's list"]);
  });

  it("makes someone else's list look like it does not exist", async () => {
    expect((await bob.get(`/api/lists/${list.id}`)).status).toBe(404);
    expect((await request(app).get(`/api/lists/${list.id}`)).status).toBe(404);
  });

  it("blocks adding, updating and removing games in someone else's list", async () => {
    const add = await bob.post(`/api/lists/${list.id}/games`).send({ igdb_id: 9, name: "Intruder" });
    const update = await bob.put(`/api/lists/${list.id}/games/${game.id}`).send({ status: "Dropped" });
    expect(add.status).toBe(404);
    expect(update.status).toBe(404);

    await bob.delete(`/api/lists/${list.id}/games/${game.id}`);
    await bob.delete(`/api/lists/${list.id}`);

    const stillThere = await alice.get(`/api/lists/${list.id}`);
    expect(stillThere.status).toBe(200);
    expect(stillThere.body.games).toHaveLength(1);
    expect(stillThere.body.games[0].status).toBe("Playing");
  });

  it("scopes dashboard stats to the signed-in user", async () => {
    const mine = await alice.get("/api/stats/currently-playing");
    const theirs = await bob.get("/api/stats/currently-playing");
    expect(mine.body.games.map((g) => g.igdb_id)).toEqual([1]);
    expect(theirs.body.games).toEqual([]);

    const bobTimes = await bob.get("/api/stats/time-to-beat");
    expect(bobTimes.body.game_count).toBe(0);
  });
});

describe("registering", () => {
  it("upgrades a guest in place and keeps their library", async () => {
    const list = await createList(client, "Keep me");
    await addGame(client, list.id);
    const guestId = (await client.get("/api/auth/me")).body.user.id;

    const res = await client.post("/api/auth/register").send(credentials);
    expect(res.status).toBe(201);
    expect(res.body.user).toEqual({ id: guestId, email: credentials.email, isGuest: false });

    const lists = await client.get("/api/lists");
    expect(lists.body.map((l) => l.name)).toEqual(["Keep me"]);
    expect(userCount()).toBe(1);
  });

  it("rotates the session when a guest registers, so the old cookie stops working", async () => {
    const first = await client.post("/api/lists").send({ name: "x" });
    const oldCookie = sessionCookie(first).split(";")[0];
    await client.post("/api/auth/register").send(credentials);

    const replay = await request(app).get("/api/auth/me").set("Cookie", oldCookie);
    expect(replay.body).toEqual({ user: null });
  });

  it("creates a normal account for a visitor with no session", async () => {
    const res = await client.post("/api/auth/register").send(credentials);
    expect(res.status).toBe(201);
    expect((await client.get("/api/auth/me")).body.user.isGuest).toBe(false);
  });

  it("normalises the email to lower case", async () => {
    await client.post("/api/auth/register").send({ ...credentials, email: "  Player@Example.COM " });
    expect((await client.get("/api/auth/me")).body.user.email).toBe("player@example.com");
  });

  it("never stores the password in plain text", async () => {
    await client.post("/api/auth/register").send(credentials);
    const { password_hash } = db.prepare("SELECT password_hash FROM users").get();
    expect(password_hash).toMatch(/^scrypt\$/);
    expect(password_hash).not.toContain(credentials.password);
  });

  it.each([
    [{ email: "", password: "longenough1" }, /valid email/],
    [{ email: "not-an-email", password: "longenough1" }, /valid email/],
    [{ email: "a@b.co", password: "short" }, /at least 8/],
    [{ email: "a@b.co", password: "x".repeat(129) }, /at most 128/],
    [{ email: 42, password: "longenough1" }, /valid email/],
    [{}, /valid email/],
  ])("rejects invalid input %j", async (body, message) => {
    const res = await client.post("/api/auth/register").send(body);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(message);
  });

  it("rejects an email that is already registered, ignoring case", async () => {
    await newClient(app).post("/api/auth/register").send(credentials);
    const res = await client.post("/api/auth/register").send({ ...credentials, email: "PLAYER@example.com" });
    expect(res.status).toBe(409);
  });

  it("refuses to register again while signed in to an account", async () => {
    await client.post("/api/auth/register").send(credentials);
    const res = await client.post("/api/auth/register").send({ email: "other@example.com", password: "longenough1" });
    expect(res.status).toBe(400);
  });
});

describe("logging in", () => {
  beforeEach(async () => {
    await newClient(app).post("/api/auth/register").send(credentials);
  });

  it("signs in with the right password", async () => {
    const res = await client.post("/api/auth/login").send(credentials);
    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({ email: credentials.email, isGuest: false });
    expect((await client.get("/api/auth/me")).body.user.email).toBe(credentials.email);
  });

  it("gives the same error for a wrong password and an unknown email", async () => {
    const wrong = await client.post("/api/auth/login").send({ ...credentials, password: "wrong password" });
    const unknown = await client.post("/api/auth/login").send({ email: "nobody@example.com", password: "whatever123" });
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(wrong.body).toEqual(unknown.body);
  });

  it.each([[{}], [{ email: credentials.email }], [{ password: "longenough1" }], [{ email: credentials.email, password: "x".repeat(129) }]])(
    "rejects a login request with missing or oversized fields %j",
    async (body) => {
      const res = await client.post("/api/auth/login").send(body);
      expect(res.status).toBe(400);
    }
  );

  it("merges guest lists into the account when asked", async () => {
    const guest = newClient(app);
    const list = await createList(guest, "From guest");
    await addGame(guest, list.id);

    const res = await guest.post("/api/auth/login").send({ ...credentials, mergeGuestData: true });
    expect(res.body.mergedLists).toBe(1);

    const lists = await guest.get("/api/lists");
    expect(lists.body.map((l) => l.name)).toEqual(["From guest"]);
    expect(db.prepare("SELECT COUNT(*) AS n FROM users WHERE is_guest = 1").get().n).toBe(0);
  });

  it("leaves guest lists behind (not merged) when not asked", async () => {
    const guest = newClient(app);
    await createList(guest, "Stays with the guest");

    const res = await guest.post("/api/auth/login").send(credentials);
    expect(res.body.mergedLists).toBe(0);
    expect((await guest.get("/api/lists")).body).toEqual([]);
  });

  it("replaces the previous session with a new one", async () => {
    const first = await client.post("/api/auth/login").send(credentials);
    const oldCookie = sessionCookie(first).split(";")[0];
    await client.post("/api/auth/login").send(credentials);
    const replay = await request(app).get("/api/auth/me").set("Cookie", oldCookie);
    expect(replay.body).toEqual({ user: null });
  });
});

describe("logging out", () => {
  it("ends the session on the server and clears the cookie", async () => {
    await client.post("/api/auth/register").send(credentials);
    const cookie = sessionCookie(await client.post("/api/auth/login").send(credentials)).split(";")[0];

    const res = await client.post("/api/auth/logout");
    expect(res.status).toBe(204);
    expect(sessionCookie(res)).toMatch(/bv_session=;/);

    expect((await client.get("/api/auth/me")).body).toEqual({ user: null });
    const replay = await request(app).get("/api/auth/me").set("Cookie", cookie);
    expect(replay.body).toEqual({ user: null });
  });

  it("is safe to call without a session", async () => {
    expect((await client.post("/api/auth/logout")).status).toBe(204);
  });
});

describe("session lifetime", () => {
  it("rejects an expired session", async () => {
    await client.post("/api/lists").send({ name: "x" });
    db.prepare("UPDATE sessions SET expires_at = ?").run(new Date(Date.now() - 1000).toISOString());
    expect((await client.get("/api/auth/me")).body).toEqual({ user: null });
  });

  it("extends the session for an active user, at most once an hour", async () => {
    await client.post("/api/lists").send({ name: "x" });
    const soon = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    db.prepare("UPDATE sessions SET expires_at = ?").run(soon);
    db.prepare("UPDATE users SET last_seen_at = ?").run(new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString());

    const res = await client.get("/api/auth/me");
    expect(sessionCookie(res)).toBeDefined();
    const { expires_at } = db.prepare("SELECT expires_at FROM sessions").get();
    expect(new Date(expires_at).getTime()).toBeGreaterThan(Date.now() + 29 * 24 * 60 * 60 * 1000);

    const again = await client.get("/api/auth/me");
    expect(sessionCookie(again)).toBeUndefined();
  });
});
