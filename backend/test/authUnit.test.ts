import { describe, it, expect, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import db from "../src/db.ts";
import { hashPassword, verifyPassword, purgeStale } from "../src/auth.ts";
import { createAuthLimiter } from "../src/authRoutes.ts";
import { resetDb, dbGet, dbAll } from "./helpers.ts";

describe("password hashing", () => {
  it("verifies the right password and rejects a wrong one", async () => {
    const stored = await hashPassword("s3cret-passphrase");
    expect(await verifyPassword("s3cret-passphrase", stored)).toBe(true);
    expect(await verifyPassword("s3cret-passphrasf", stored)).toBe(false);
  });

  it("uses a different random salt every time", async () => {
    const a = await hashPassword("same password");
    const b = await hashPassword("same password");
    expect(a).not.toBe(b);
    expect(await verifyPassword("same password", a)).toBe(true);
    expect(await verifyPassword("same password", b)).toBe(true);
  });

  it.each([[""], ["plaintext"], ["scrypt$bad"], ["bcrypt$1$2$3$a$b"], ["scrypt$3$8$1$c2FsdA==$aGFzaA=="]])(
    "treats a malformed stored hash %j as a failed login instead of throwing",
    async (stored) => {
      expect(await verifyPassword("anything", stored)).toBe(false);
    }
  );
});

describe("purgeStale", () => {
  const daysAgo = (n) => new Date(Date.now() - n * 24 * 60 * 60 * 1000).toISOString();
  const insertUser = (isGuest, lastSeen) =>
    Number(
      db
        .prepare("INSERT INTO users (email, is_guest, created_at, last_seen_at) VALUES (?, ?, ?, ?)")
        .run(isGuest ? null : `u${Math.random()}@x.co`, isGuest ? 1 : 0, lastSeen, lastSeen).lastInsertRowid
    );

  beforeEach(resetDb);

  it("removes old guests and their data but keeps recent guests and registered users", () => {
    const oldGuest = insertUser(true, daysAgo(100));
    const recentGuest = insertUser(true, daysAgo(5));
    const oldRegistered = insertUser(false, daysAgo(400));

    const listId = Number(db.prepare("INSERT INTO lists (name, user_id) VALUES ('old', ?)").run(oldGuest).lastInsertRowid);
    db.prepare("INSERT INTO list_games (list_id, igdb_id, name) VALUES (?, 1, 'g')").run(listId);

    const result = purgeStale();
    expect(result.guests).toBe(1);

    const remaining = dbAll("SELECT id FROM users ORDER BY id").map((u) => u.id);
    expect(remaining).toEqual([recentGuest, oldRegistered]);
    expect(dbGet("SELECT COUNT(*) AS n FROM lists").n).toBe(0);
    expect(dbGet("SELECT COUNT(*) AS n FROM list_games").n).toBe(0);
  });

  it("removes expired sessions only", () => {
    const user = insertUser(false, daysAgo(1));
    const add = (hash, expires) =>
      db.prepare("INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)").run(hash, user, daysAgo(2), expires);
    add("expired", daysAgo(1));
    add("valid", new Date(Date.now() + 86400000).toISOString());

    expect(purgeStale().sessions).toBe(1);
    expect(dbAll("SELECT token_hash FROM sessions").map((s) => s.token_hash)).toEqual(["valid"]);
  });
});

describe("createAuthLimiter", () => {
  it("returns 429 once the limit is exceeded", async () => {
    const app = express();
    app.use(createAuthLimiter(2));
    app.post("/attempt", (req, res) => res.json({ ok: true }));

    expect((await request(app).post("/attempt")).status).toBe(200);
    expect((await request(app).post("/attempt")).status).toBe(200);
    const blocked = await request(app).post("/attempt");
    expect(blocked.status).toBe(429);
    expect(blocked.body.error).toMatch(/too many/i);
  });
});
